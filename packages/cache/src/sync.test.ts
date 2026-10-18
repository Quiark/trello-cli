import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import { EventEmitter } from "events";
import DB from "./db";
import Setup from "./setup";
import Sync from "./sync";

describe("incremental sync", () => {
  let directory: string;
  let db: DB;
  let sync: Sync;
  let api: jest.SpyInstance;
  let board: any;
  let cards: any[];
  let content: any;
  let labels: any[];

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trello-sync-"));
    db = new DB(directory, "test");
    new Setup(db).bootstrap();
    board = {
      id: "board1",
      name: "Board",
      closed: false,
      shortLink: "board-link",
      idOrganization: null,
      idMemberCreator: "member1",
      organization: null,
      lists: [{ id: "list1", name: "To do", idBoard: "board1", closed: false }],
      members: [
        { id: "member1", username: "alice", fullName: "Alice", initials: "A" },
      ],
    };
    cards = [
      {
        id: "card1",
        idBoard: "board1",
        idList: "list1",
        closed: false,
        dateLastActivity: "2026-10-18T10:00:00.000Z",
      },
    ];
    content = {
      ...cards[0],
      name: "Ticket",
      shortLink: "card-link",
      desc: "Full description",
      due: "2026-11-01T00:00:00.000Z",
      dueComplete: false,
      start: null,
      url: "https://trello.com/c/card-link",
      idMembers: ["member1"],
      labels: [{ id: "label1", name: "Bug", color: "red" }],
    };
    labels = [{ id: "label1", name: "Bug", idBoard: "board1", color: "red" }];
    sync = new Sync(db, "key", "token");
    api = jest.spyOn(sync, "api").mockImplementation(async (url) => {
      switch (url) {
        case "/members/me/boards":
          return [{ id: board.id, closed: board.closed }];
        case "/boards/board1":
          return board;
        case "/boards/board1/cards/open":
          return cards;
        case "/boards/board1/labels":
          return labels;
        case "/cards/card1":
          return content;
        default:
          throw new Error(`Unexpected request: ${url}`);
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("stores content without requesting comments, attachments or actions", async () => {
    await sync.run();
    expect(db.get("SELECT * FROM cards WHERE id=?", ["card1"])).toEqual({
      id: "card1",
      name: "Ticket",
      boardId: "board1",
      listId: "list1",
      shortLink: "card-link",
      description: "Full description",
      due: content.due,
      dueComplete: 0,
      start: null,
      url: content.url,
      labels: JSON.stringify(content.labels),
      memberIds: '["member1"]',
      dateLastActivity: content.dateLastActivity,
    });
    expect(
      api.mock.calls.every(([url]) => !/actions|comments|attachments/.test(url))
    ).toBe(true);
    expect(api).toHaveBeenCalledWith("/boards/board1/cards/open", {
      fields: "id,closed,idBoard,idList,dateLastActivity",
      limit: 1000,
      sort: "-id",
    });
  });

  it("does not download or rewrite unchanged content", async () => {
    await sync.run();
    api.mockClear();
    const upsert = jest.spyOn(db, "upsert");
    await sync.run();
    expect(api.mock.calls.some(([url]) => url.startsWith("/cards/"))).toBe(
      false
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refreshes changed content and list moves", async () => {
    await sync.run();
    board.lists.push({ id: "list2", name: "Doing", closed: false });
    cards[0] = {
      ...cards[0],
      idList: "list2",
      dateLastActivity: "2026-10-18T11:00:00.000Z",
    };
    content = { ...content, ...cards[0], desc: "Updated", dueComplete: true };
    await sync.run();
    expect(
      db.get("SELECT description, listId, dueComplete FROM cards", [])
    ).toEqual({
      description: "Updated",
      listId: "list2",
      dueComplete: 1,
    });
  });

  it("refreshes label names and deletions without downloading unchanged cards", async () => {
    await sync.run();
    api.mockClear();
    labels[0].name = "Renamed bug";
    await sync.run();
    expect(
      JSON.parse((db.get("SELECT labels FROM cards", []) as any).labels)
    ).toEqual([{ id: "label1", name: "Renamed bug", color: "red" }]);
    labels = [];
    await sync.run();
    expect(db.get("SELECT labels FROM cards", [])).toEqual({ labels: "[]" });
    expect(api.mock.calls.some(([url]) => url.startsWith("/cards/"))).toBe(
      false
    );
  });

  it("refreshes a moved card even if its activity timestamp is unchanged", async () => {
    await sync.run();
    api.mockClear();
    board.lists.push({ id: "list2", name: "Doing", closed: false });
    cards[0].idList = "list2";
    content.idList = "list2";
    await sync.run();
    expect(api).toHaveBeenCalledWith("/cards/card1", expect.any(Object));
  });

  it.each(["archived", "deleted", "archived list", "archived board"])(
    "removes cached cards after %s",
    async (change) => {
      await sync.run();
      api.mockClear();
      if (change === "archived") cards[0].closed = true;
      if (change === "deleted") cards = [];
      if (change === "archived list") board.lists[0].closed = true;
      if (change === "archived board") board.closed = true;
      await sync.run();
      expect(db.all("SELECT * FROM cards", [])).toEqual([]);
      if (change === "archived list" || change === "archived board") {
        expect(db.all("SELECT * FROM lists", [])).toEqual([]);
      }
      if (change === "archived board") {
        expect(db.all("SELECT * FROM boards", [])).toEqual([]);
        expect(api).not.toHaveBeenCalledWith(
          "/boards/board1",
          expect.anything()
        );
      }
      expect(api.mock.calls.some(([url]) => url.startsWith("/cards/"))).toBe(
        false
      );
    }
  );

  it("reconciles stale metadata and a successful empty board inventory", async () => {
    await sync.run();
    labels = [];
    await sync.run();
    expect(db.all("SELECT * FROM labels", [])).toEqual([]);
    api.mockResolvedValue([]);
    await sync.run();
    for (const table of [
      "cards",
      "boards",
      "lists",
      "members",
      "labels",
      "orgs",
    ]) {
      expect(db.all(`SELECT * FROM ${table}`, [])).toEqual([]);
    }
  });

  it("preserves the snapshot if a request fails", async () => {
    await sync.run();
    const before = db.all("SELECT * FROM cards", []);
    cards[0].dateLastActivity = "2026-10-18T12:00:00.000Z";
    const handler = api.getMockImplementation()!;
    api.mockImplementation((url, options) => {
      if (url === "/cards/card1") throw new Error("Unavailable");
      return handler(url, options);
    });
    await expect(sync.run()).rejects.toThrow("Unavailable");
    expect(db.all("SELECT * FROM cards", [])).toEqual(before);
  });

  it("rejects malformed inventories without deleting existing rows", async () => {
    await sync.run();
    api.mockResolvedValue({ error: "not authorized" });
    await expect(sync.run()).rejects.toThrow("expected an array");
    expect(db.all("SELECT * FROM cards", [])).toHaveLength(1);
  });

  it("rejects incomplete card locations instead of treating them as removals", async () => {
    await sync.run();
    cards[0].dateLastActivity = "2026-10-18T12:00:00.000Z";
    delete content.idList;
    await expect(sync.run()).rejects.toThrow("Invalid Trello card content");
    expect(db.all("SELECT * FROM cards", [])).toHaveLength(1);
    delete cards[0].idList;
    await expect(sync.run()).rejects.toThrow("Invalid Trello card inventory");
    expect(db.all("SELECT * FROM cards", [])).toHaveLength(1);
  });

  it("rolls back all writes if reconciliation fails", async () => {
    await sync.run();
    board.name = "Changed board";
    cards = [];
    labels = [{ id: "label2", name: "New", color: "blue" }];
    const write = db.upsert.bind(db);
    jest.spyOn(db, "upsert").mockImplementation((table, row) => {
      if (table === "labels") throw new Error("Write failed");
      return write(table, row);
    });
    await expect(sync.run()).rejects.toThrow("Write failed");
    expect(db.get("SELECT name FROM boards", [])).toEqual({ name: "Board" });
    expect(db.all("SELECT * FROM cards", [])).toHaveLength(1);
    expect(db.all("SELECT * FROM labels", [])[0]).toMatchObject({
      id: "label1",
    });
  });

  it("paginates card inventory before pruning", async () => {
    const inventory = Array.from({ length: 1001 }, (_, i) => ({
      ...cards[0],
      id: i.toString(16).padStart(24, "0"),
      idList: "archived-list",
    }));
    inventory[0] = { ...cards[0], id: "000000000000000000000000" };
    const handler = api.getMockImplementation()!;
    api.mockImplementation((url, options: any) => {
      if (url === "/boards/board1/cards/open") {
        const sorted =
          options.sort === "-id" ? [...inventory].reverse() : inventory;
        return Promise.resolve(
          sorted
            .filter((card) => !options.before || card.id < options.before)
            .slice(0, options.limit)
        );
      }
      if (url === "/cards/000000000000000000000000") {
        return Promise.resolve({ ...content, id: "000000000000000000000000" });
      }
      return handler(url, options);
    });
    await sync.run();
    expect(api).toHaveBeenCalledWith(
      "/boards/board1/cards/open",
      expect.objectContaining({
        before: "000000000000000000000001",
        sort: "-id",
      })
    );
    expect(db.all("SELECT id FROM cards", [])).toEqual([
      { id: "000000000000000000000000" },
    ]);
  });

  it("rejects stalled pagination rather than pruning from a partial inventory", async () => {
    await sync.run();
    cards = Array.from({ length: 1000 }, (_, i) => ({
      ...cards[0],
      id: `card${i}`,
    }));
    await expect(sync.run()).rejects.toThrow("pagination did not advance");
    expect(db.all("SELECT * FROM cards", [])).toHaveLength(1);
  });

  it("does not cache a card archived during detail retrieval", async () => {
    content.closed = true;
    await sync.run();
    expect(db.all("SELECT * FROM cards", [])).toEqual([]);
  });

  it("caches organizations when present", async () => {
    board.organization = {
      id: "org1",
      displayName: "Workspace",
      idMemberCreator: "member1",
    };
    board.idOrganization = "org1";
    await sync.run();
    expect(db.get("SELECT * FROM orgs", [])).toEqual({
      id: "org1",
      displayName: "Workspace",
      creatorId: "member1",
    });
  });

  it("rejects non-success HTTP responses without exposing credentials", async () => {
    jest.spyOn(https, "get").mockImplementation(((_url: any, callback: any) => {
      const response = new EventEmitter() as any;
      response.statusCode = 429;
      process.nextTick(() => {
        callback(response);
        response.emit("data", '{"error":"rate limit"}');
        response.emit("end");
      });
      return new EventEmitter();
    }) as any);
    await expect(sync.get("https://api.trello.com/1/test")).rejects.toThrow(
      "HTTP 429"
    );
  });
});
