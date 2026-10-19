import fs from "fs";
import os from "os";
import path from "path";
import DB from "./db";
import Setup from "./setup";

describe("cache schema migration", () => {
  it("adds content columns to an existing database without losing rows", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trello-schema-"));
    const db = new DB(directory, "test");
    try {
      db.run(
        "CREATE TABLE cards (id VARCHAR PRIMARY KEY, name VARCHAR, boardId VARCHAR, listId VARCHAR, shortLink VARCHAR)"
      );
      db.upsert("cards", { id: "card1", name: "Existing card" });
      const setup = new Setup(db);
      setup.bootstrap();
      setup.bootstrap();
      expect(
        db.get(
          "SELECT id, idShort, name, description, dateLastActivity FROM cards",
          []
        )
      ).toEqual({
        id: "card1",
        idShort: null,
        name: "Existing card",
        description: null,
        dateLastActivity: null,
      });
      db.run(
        "UPDATE cards SET description=?, memberIds=?, labels=? WHERE id=?",
        ["Description", '["member1"]', "[]", "card1"]
      );
      expect(db.get("SELECT description FROM cards", [])).toEqual({
        description: "Description",
      });
    } finally {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
