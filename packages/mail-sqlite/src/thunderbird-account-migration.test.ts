import { describe, expect, it } from "vitest";
import { migrateMailbox } from "./migrations";
import { createNodeSqliteDriver } from "./node-sqlite";
import { migrateThunderbirdAccounts } from "./thunderbird-account-migration";

describe("Thunderbird SQLite account migration", () => {
  it("preserves cascading indexes and existing accounts when upgrading an already migrated database", async () => {
    const driver = createNodeSqliteDriver();
    try {
      await driver.write(async (tx) => {
        await migrateMailbox(tx, "epoch");
        await tx.execute("DELETE FROM schema_migrations WHERE id = 10");
        await tx.exec(`
          PRAGMA defer_foreign_keys = ON;
          CREATE TABLE accounts_before_10 (
            account_id TEXT PRIMARY KEY,
            provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','smartermail')),
            generation TEXT NOT NULL, assistant_cursor TEXT, connection TEXT
          );
          DROP TABLE accounts;
          ALTER TABLE accounts_before_10 RENAME TO accounts;
          PRAGMA defer_foreign_keys = OFF;
        `);
        await tx.exec(`
          INSERT INTO accounts VALUES ('sm', 'smartermail', 'generation', 'cursor', '{"state":"connected"}');
          INSERT INTO effective_role_conversations VALUES ('sm', 'thread', 'inbox', 10, 1, 0);
          INSERT INTO effective_message_memberships VALUES ('sm', 'label', 'INBOX', 'message', 'thread', 10, 0, 0);
        `);
      });
      await expect(
        driver.write((tx) =>
          tx.execute(
            "INSERT INTO accounts(account_id, provider, generation) VALUES ('tb', 'thunderbird', 'g')",
          ),
        ),
      ).rejects.toThrow();
      const before = await driver.read(async (tx) => ({
        accounts: await tx.query("SELECT * FROM accounts"),
        conversations: await tx.query(
          "SELECT * FROM effective_role_conversations",
        ),
        memberships: await tx.query(
          "SELECT * FROM effective_message_memberships",
        ),
      }));
      await driver.write((tx) => migrateThunderbirdAccounts(tx));
      const after = await driver.read(async (tx) => ({
        accounts: await tx.query("SELECT * FROM accounts"),
        conversations: await tx.query(
          "SELECT * FROM effective_role_conversations",
        ),
        memberships: await tx.query(
          "SELECT * FROM effective_message_memberships",
        ),
      }));
      expect(after).toEqual(before);
      await driver.write((tx) =>
        tx.execute(
          "INSERT INTO accounts(account_id, provider, generation) VALUES ('tb', 'thunderbird', 'g')",
        ),
      );
      await driver.write((tx) => migrateThunderbirdAccounts(tx));
      expect(
        await driver.read((tx) =>
          tx.query("SELECT provider FROM accounts WHERE account_id = 'tb'"),
        ),
      ).toEqual([{ provider: "thunderbird" }]);
      expect(
        await driver.read((tx) => tx.query("PRAGMA foreign_key_check")),
      ).toEqual([]);
      await expect(
        driver.write((tx) =>
          tx.execute(
            "INSERT INTO accounts(account_id, provider, generation) VALUES ('bad', 'unknown', 'g')",
          ),
        ),
      ).rejects.toThrow();
      await driver.write((tx) =>
        tx.execute("DELETE FROM accounts WHERE account_id = 'sm'"),
      );
      expect(
        await driver.read((tx) =>
          tx.query("SELECT * FROM effective_role_conversations"),
        ),
      ).toEqual([]);
      expect(
        await driver.read((tx) =>
          tx.query("SELECT * FROM effective_message_memberships"),
        ),
      ).toEqual([]);
    } finally {
      await driver.close();
    }
  });
});
