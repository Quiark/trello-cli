import DB from "./db";

export default class {
  protected db: DB;

  protected tables = {
    orgs: {
      id: "VARCHAR",
      displayName: "VARCHAR",
      creatorId: "VARCHAR",
    },
    boards: {
      id: "VARCHAR",
      name: "VARCHAR",
      orgId: "VARCHAR",
      creatorId: "VARCHAR",
      shortLink: "VARCHAR",
      closed: "INT",
    },
    lists: {
      id: "VARCHAR",
      name: "VARCHAR",
      boardId: "VARCHAR",
      closed: "INT",
    },
    cards: {
      id: "VARCHAR",
      // Trello's numeric ticket number, scoped to its board.
      idShort: "INT",
      name: "VARCHAR",
      boardId: "VARCHAR",
      listId: "VARCHAR",
      shortLink: "VARCHAR",
      description: "TEXT",
      due: "VARCHAR",
      dueComplete: "INT",
      start: "VARCHAR",
      url: "VARCHAR",
      labels: "TEXT",
      memberIds: "TEXT",
      dateLastActivity: "VARCHAR",
    },
    members: {
      id: "VARCHAR",
      username: "VARCHAR",
      fullName: "VARCHAR",
      initials: "VARCHAR",
    },
    labels: {
      id: "VARCHAR",
      name: "VARCHAR",
      boardId: "VARCHAR",
      color: "VARCHAR",
    },
  };
  constructor(db: DB) {
    this.db = db;
  }

  bootstrap() {
    Object.entries(this.tables).forEach(([table, fields]) => {
      let sql = `CREATE TABLE IF NOT EXISTS ${table}`;
      const columns: string[] = [];

      Object.entries(fields).forEach(([name, type]) => {
        let pKey = "";
        if (name == "id") {
          pKey = "PRIMARY KEY";
        }
        columns.push(`${name} ${type} ${pKey}`);
      });
      sql = `${sql} (${columns.join(", ")})`;

      this.db.run(sql);
      const existing = this.db.all(`PRAGMA table_info(${table})`, []) as {
        name: string;
      }[];
      for (const [name, type] of Object.entries(fields)) {
        if (!existing.some((column) => column.name === name)) {
          this.db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
        }
      }
    });
  }

  teardown() {
    Object.keys(this.tables).forEach((table) => {
      this.db.run(`DELETE FROM ${table}`);
    });
  }
}
