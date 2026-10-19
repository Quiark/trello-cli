import * as https from "https";
import * as querystring from "querystring";
import DB from "./db";

const inventoryFields = "id,idShort,closed,idBoard,idList,dateLastActivity";
const contentFields =
  "id,idShort,closed,idBoard,idList,name,shortLink,desc,due,dueComplete,start,url,labels,idMembers,dateLastActivity";
const tables = [
  "orgs",
  "boards",
  "lists",
  "cards",
  "members",
  "labels",
] as const;
type Row = Record<string, any>;
type Snapshot = Record<(typeof tables)[number], Map<string, Row>>;

export default class Sync {
  constructor(
    protected db: DB,
    protected appKey: string,
    protected token: string
  ) {}

  async run(onProgress?: (message: string) => void): Promise<void> {
    onProgress?.("Fetching open boards...");
    const snapshot: Snapshot = {
      orgs: new Map(),
      boards: new Map(),
      lists: new Map(),
      cards: new Map(),
      members: new Map(),
      labels: new Map(),
    };
    const cached = new Map(
      (this.db.all("SELECT * FROM cards", []) as Row[]).map((card) => [
        card.id,
        card,
      ])
    );
    const boards = this.collection(
      await this.api("/members/me/boards", {
        filter: "open",
        fields: "id,closed",
      })
    );

    onProgress?.(`Found ${boards.length} boards`);
    for (const [boardIndex, summary] of boards.entries()) {
      if (this.isClosed(summary)) continue;
      onProgress?.(`Fetching board ${boardIndex + 1}/${boards.length}...`);
      const board = await this.api(`/boards/${summary.id}`, {
        lists: "all",
        list_fields: "id,name,idBoard,closed",
        members: "all",
        organization: "true",
        organization_fields: "id,displayName,idMemberCreator",
        fields: "id,name,closed,idOrganization,shortLink,idMemberCreator",
      });
      this.entity(board);
      if (this.isClosed(board)) continue;
      onProgress?.(`Fetching labels and card inventory for ${board.name}...`);
      snapshot.boards.set(board.id, {
        id: board.id,
        name: board.name,
        orgId: board.idOrganization ?? null,
        creatorId: board.idMemberCreator ?? null,
        shortLink: board.shortLink,
        closed: 0,
      });
      for (const list of this.collection(board.lists)) {
        if (!this.isClosed(list)) {
          snapshot.lists.set(list.id, {
            id: list.id,
            name: list.name,
            boardId: board.id,
            closed: 0,
          });
        }
      }
      for (const member of this.collection(board.members)) {
        snapshot.members.set(member.id, {
          id: member.id,
          username: member.username,
          fullName: member.fullName,
          initials: member.initials,
        });
      }
      if (board.organization) {
        const org = board.organization;
        this.entity(org);
        snapshot.orgs.set(org.id, {
          id: org.id,
          displayName: org.displayName,
          creatorId: org.idMemberCreator ?? null,
        });
      }
      const labels = this.collection(
        await this.api(`/boards/${board.id}/labels`, {
          fields: "all",
          limit: 1000,
        })
      );
      if (labels.length === 1000) {
        throw new Error("Trello label inventory may be truncated");
      }
      for (const label of labels) {
        snapshot.labels.set(label.id, {
          id: label.id,
          name: label.name,
          boardId: board.id,
          color: label.color ?? null,
        });
      }
      const inventory = await this.pages(`/boards/${board.id}/cards/open`, {
        fields: inventoryFields,
      });
      for (const [cardIndex, card] of inventory.entries()) {
        if (cardIndex % 25 === 0) {
          onProgress?.(
            `${board.name}: processing cards ${cardIndex}/${inventory.length}`
          );
        }
        if (
          card.idBoard !== board.id ||
          !Number.isInteger(card.idShort) ||
          typeof card.idList !== "string" ||
          typeof card.dateLastActivity !== "string"
        ) {
          throw new Error("Invalid Trello card inventory");
        }
        if (this.isClosed(card) || !snapshot.lists.has(card.idList)) continue;
        const previous = cached.get(card.id);
        if (
          previous &&
          previous.dateLastActivity === card.dateLastActivity &&
          previous.boardId === card.idBoard &&
          previous.listId === card.idList
        ) {
          snapshot.cards.set(card.id, { ...previous, idShort: card.idShort });
          continue;
        }
        const content = await this.api(`/cards/${card.id}`, {
          fields: contentFields,
        });
        this.entity(content);
        if (
          content.id !== card.id ||
          !Number.isInteger(content.idShort) ||
          typeof content.idBoard !== "string" ||
          typeof content.idList !== "string"
        ) {
          throw new Error("Invalid Trello card content");
        }
        // A card may move or be archived between the inventory and detail requests.
        if (
          this.isClosed(content) ||
          content.idBoard !== board.id ||
          !snapshot.lists.has(content.idList)
        ) {
          continue;
        }
        if (
          typeof content.dateLastActivity !== "string" ||
          typeof content.desc !== "string" ||
          !Array.isArray(content.idMembers) ||
          !content.idMembers.every((id: unknown) => typeof id === "string")
        ) {
          throw new Error("Invalid Trello card content");
        }
        snapshot.cards.set(content.id, {
          id: content.id,
          idShort: content.idShort,
          name: content.name,
          boardId: content.idBoard,
          listId: content.idList,
          shortLink: content.shortLink,
          description: content.desc,
          due: content.due ?? null,
          dueComplete: content.dueComplete ? 1 : 0,
          start: content.start ?? null,
          url: content.url,
          labels: JSON.stringify(this.collection(content.labels)),
          memberIds: JSON.stringify(content.idMembers),
          dateLastActivity: content.dateLastActivity,
        });
      }
      onProgress?.(
        `${board.name}: processed ${inventory.length}/${inventory.length} cards`
      );
    }

    // Label renames/deletions need not change the activity timestamp of each card.
    for (const card of snapshot.cards.values()) {
      const labels = (JSON.parse(card.labels) as Row[])
        .map((label) => snapshot.labels.get(label.id))
        .filter((label): label is Row => Boolean(label))
        .map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
        }));
      snapshot.cards.set(card.id, { ...card, labels: JSON.stringify(labels) });
    }

    // Do not prune or replace any cached data until the complete snapshot is available.
    onProgress?.(
      `Saving ${snapshot.cards.size} cards from ${snapshot.boards.size} boards...`
    );
    this.db.transaction(() => {
      for (const table of tables) {
        const existing = this.db.all(`SELECT * FROM ${table}`, []) as Row[];
        const incoming = snapshot[table];
        const previous = new Map(existing.map((row) => [row.id, row]));
        for (const row of incoming.values()) {
          const old = previous.get(row.id);
          if (!old || Object.keys(row).some((key) => old[key] !== row[key])) {
            this.db.upsert(table, row);
          }
        }
        for (const row of existing) {
          if (!incoming.has(row.id)) {
            this.db.run(`DELETE FROM ${table} WHERE id=?`, [row.id]);
          }
        }
      }
    });
  }

  protected entity(value: any): void {
    if (!value || typeof value.id !== "string") {
      throw new Error("Invalid Trello response: expected an object with an ID");
    }
  }

  protected isClosed(value: Row): boolean {
    if (typeof value.closed !== "boolean") {
      throw new Error("Invalid Trello response: expected an archive flag");
    }
    return value.closed;
  }

  protected collection(value: any): Row[] {
    if (!Array.isArray(value)) {
      throw new Error("Invalid Trello response: expected an array");
    }
    value.forEach((item) => this.entity(item));
    return value;
  }

  protected async pages(url: string, options: Row): Promise<Row[]> {
    const result: Row[] = [];
    const seen = new Set<string>();
    let before: string | undefined;
    while (true) {
      const page = this.collection(
        await this.api(url, {
          ...options,
          limit: 1000,
          sort: "-id",
          ...(before ? { before } : {}),
        })
      );
      for (const item of page) {
        if (seen.has(item.id)) {
          throw new Error("Trello pagination did not advance");
        }
        seen.add(item.id);
        result.push(item);
      }
      if (page.length < 1000) return result;
      before = page[page.length - 1].id;
    }
  }

  async api(url: string, options?: object): Promise<any> {
    return this.get(`https://api.trello.com/1${url}`, options);
  }

  async get(url: string, options: object = {}): Promise<any> {
    const query = querystring.stringify({
      key: this.appKey,
      token: this.token,
      ...options,
    });
    return new Promise((resolve, reject) => {
      https
        .get(`${url}?${query}`, (response) => {
          let data = "";
          response.on("error", reject);
          response.on("aborted", () =>
            reject(new Error("Trello response aborted"))
          );
          response.on("data", (chunk) => {
            data += chunk;
          });
          response.on("end", () => {
            if (
              !response.statusCode ||
              response.statusCode < 200 ||
              response.statusCode >= 300
            ) {
              reject(
                new Error(`Trello request failed (HTTP ${response.statusCode})`)
              );
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(error);
            }
          });
        })
        .on("error", reject);
    });
  }
}
