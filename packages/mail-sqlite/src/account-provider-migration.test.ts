import { describe, expect, it } from "vitest";
import { MAILBOX_SCHEMA_SQL, migrateMailbox } from "./migrations";
import { createNodeSqliteDriver } from "./node-sqlite";
import {
  migrateConversationIndex,
  migrateMembershipIndex,
  migrateInboxUnreadExcludesArchive,
} from "./conversation-index";

describe("SmarterMail SQLite account migration", () => {
  it("preserves existing accounts and referencing messages while enabling SmarterMail", async () => {
    const driver = createNodeSqliteDriver();
    try {
      await driver.write(async (tx) => {
        await tx.exec(MAILBOX_SCHEMA_SQL);
        await tx.exec("ALTER TABLE accounts ADD COLUMN connection TEXT");
        await tx.execute("INSERT INTO accounts VALUES (?, ?, ?, ?, ?)", [
          "google-account",
          "google",
          "generation",
          "cursor",
          '{"state":"connected"}',
        ]);
        await tx.exec(`INSERT INTO messages (
          account_id, message_id, conversation_id, provider, subject, preview,
          from_address, to_json, cc_json, received_at_ms, read, starred,
          label_ids_json, category_ids_json, roles_json, in_inbox, in_sent,
          in_draft, in_trash, in_spam, has_attachments
        ) VALUES ('google-account', 'message', 'thread', 'google', 'subject', 'preview',
          'sender@example.com', '[]', '[]', 1, 0, 0, '[]', '[]', '[]', 1, 0, 0, 0, 0, 0)`);
        await migrateConversationIndex(tx);
        await migrateMembershipIndex(tx);
        await migrateInboxUnreadExcludesArchive(tx);
        await tx.exec(`
          INSERT INTO effective_role_conversations VALUES ('google-account', 'thread', 'inbox', 10, 1, 0);
          INSERT INTO effective_message_memberships VALUES ('google-account', 'label', 'INBOX', 'message', 'thread', 10, 0, 0);
        `);
      });
      const indexesBefore = await driver.read(async (tx) => ({
        conversations: await tx.query(
          "SELECT * FROM effective_role_conversations",
        ),
        memberships: await tx.query(
          "SELECT * FROM effective_message_memberships",
        ),
      }));
      expect(indexesBefore.conversations).toHaveLength(1);
      expect(indexesBefore.memberships).toHaveLength(1);
      await expect(
        driver.write((tx) =>
          tx.execute(
            "INSERT INTO accounts(account_id, provider, generation) VALUES ('sm', 'smartermail', 'g')",
          ),
        ),
      ).rejects.toThrow();
      await driver.write((tx) => migrateMailbox(tx, "epoch"));
      await driver.write((tx) =>
        tx.execute(
          "INSERT INTO accounts(account_id, provider, generation) VALUES ('sm', 'smartermail', 'g')",
        ),
      );
      const result = await driver.read(async (tx) => ({
        accounts: await tx.query("SELECT * FROM accounts ORDER BY account_id"),
        messages: await tx.query(
          "SELECT account_id, message_id, subject FROM messages",
        ),
        violations: await tx.query("PRAGMA foreign_key_check"),
        conversations: await tx.query(
          "SELECT * FROM effective_role_conversations",
        ),
        memberships: await tx.query(
          "SELECT * FROM effective_message_memberships",
        ),
      }));
      expect(result.accounts[0]).toMatchObject({
        account_id: "google-account",
        provider: "google",
        generation: "generation",
        assistant_cursor: "cursor",
        connection: '{"state":"connected"}',
      });
      expect(result.accounts[1]).toMatchObject({
        account_id: "sm",
        provider: "smartermail",
      });
      expect(result.messages).toEqual([
        {
          account_id: "google-account",
          message_id: "message",
          subject: "subject",
        },
      ]);
      expect(result.violations).toEqual([]);
      expect(result.conversations).toEqual(indexesBefore.conversations);
      expect(result.memberships).toEqual(indexesBefore.memberships);
      await driver.write((tx) => migrateMailbox(tx, "different-epoch"));
      expect(
        await driver.read((tx) =>
          tx.query("SELECT database_epoch FROM profile_state"),
        ),
      ).toEqual([{ database_epoch: "epoch" }]);
      await expect(
        driver.write((tx) =>
          tx.execute("UPDATE messages SET account_id = 'missing'"),
        ),
      ).rejects.toThrow();
      await expect(
        driver.write((tx) =>
          tx.execute(
            "INSERT INTO accounts(account_id, provider, generation) VALUES ('bad', 'unsupported', 'g')",
          ),
        ),
      ).rejects.toThrow();
      await driver.write(async (tx) => {
        await tx.execute(
          "DELETE FROM messages WHERE account_id = 'google-account'",
        );
        await tx.execute(
          "DELETE FROM accounts WHERE account_id = 'google-account'",
        );
      });
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
