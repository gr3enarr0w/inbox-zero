import type { SqlTransaction } from "./driver";

export async function migrateAccountProviders(tx: SqlTransaction) {
  if ((await tx.query("SELECT 1 FROM schema_migrations WHERE id = 9")).length)
    return;
  // DROP TABLE fires ON DELETE CASCADE even with deferred constraints. Preserve
  // the account-owned indexes while rebuilding the parent inside this transaction.
  await tx.exec(`
    PRAGMA defer_foreign_keys = ON;
    CREATE TEMP TABLE account_roles_0009 AS SELECT * FROM effective_role_conversations;
    CREATE TEMP TABLE account_memberships_0009 AS SELECT * FROM effective_message_memberships;
    CREATE TABLE accounts_0009 (
      account_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'smartermail')),
      generation TEXT NOT NULL,
      assistant_cursor TEXT,
      connection TEXT
    );
    INSERT INTO accounts_0009(account_id, provider, generation, assistant_cursor, connection)
      SELECT account_id, provider, generation, assistant_cursor, connection FROM accounts;
    DROP TABLE accounts;
    ALTER TABLE accounts_0009 RENAME TO accounts;
    INSERT INTO effective_role_conversations SELECT * FROM account_roles_0009;
    INSERT INTO effective_message_memberships SELECT * FROM account_memberships_0009;
    DROP TABLE account_roles_0009;
    DROP TABLE account_memberships_0009;
  `);
  if ((await tx.query("PRAGMA foreign_key_check")).length) {
    throw new Error(
      "Account provider migration found invalid foreign key references",
    );
  }
  // SQLite keeps deferred DROP TABLE violations after the replacement restores
  // every referenced key. Validate actual references before resetting that counter.
  await tx.exec("PRAGMA defer_foreign_keys = OFF");
  await tx.execute(
    "INSERT INTO schema_migrations(id, name) VALUES (9, '0009-smartermail-accounts')",
  );
}
