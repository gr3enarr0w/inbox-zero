CREATE TABLE "SmarterMailStatsImportState" (
    "emailAccountId" TEXT NOT NULL,
    "cursor" TEXT,
    "generation" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'scan',
    "after" TIMESTAMP(3),
    "before" TIMESTAMP(3) NOT NULL,
    "historyComplete" BOOLEAN NOT NULL DEFAULT false,
    "historyRequested" BOOLEAN NOT NULL DEFAULT false,
    "totalImported" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "importError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmarterMailStatsImportState_pkey" PRIMARY KEY ("emailAccountId")
);
ALTER TABLE "SmarterMailStatsImportState" ADD CONSTRAINT "SmarterMailStatsImportState_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailMessage" ADD COLUMN "smarterMailStatsGeneration" TEXT;
CREATE INDEX "EmailMessage_emailAccountId_smarterMailStatsGeneration_date_idx" ON "EmailMessage"("emailAccountId", "smarterMailStatsGeneration", "date");

ALTER TABLE "EmailMessage" ADD COLUMN "providerFolderId" TEXT, ADD COLUMN "removedAt" TIMESTAMP(3), ADD COLUMN "lastCheckedAt" TIMESTAMP(3);
CREATE INDEX "EmailMessage_account_folder_removed_checked_idx" ON "EmailMessage"("emailAccountId", "providerFolderId", "removedAt", "lastCheckedAt");
CREATE TABLE "SmarterMailStatsFolderState" (
  "emailAccountId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "folderGuid" TEXT,
  "cursor" TEXT,
  "uidCursor" TEXT,
  "uidGeneration" TEXT NOT NULL,
  "baselineComplete" BOOLEAN NOT NULL DEFAULT false,
  "uidScanComplete" BOOLEAN NOT NULL DEFAULT false,
  "uidNextRefreshAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "historyBefore" TIMESTAMP(3) NOT NULL,
  "after" TIMESTAMP(3),
  "before" TIMESTAMP(3) NOT NULL,
  "refreshAfter" TIMESTAMP(3),
  "historyComplete" BOOLEAN NOT NULL DEFAULT false,
  "recentComplete" BOOLEAN NOT NULL DEFAULT false,
  "generation" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'recent',
  "completedAt" TIMESTAMP(3),
  "nextRefreshAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmarterMailStatsFolderState_pkey" PRIMARY KEY ("emailAccountId", "folderId")
);
CREATE INDEX "SmarterMailStatsFolderState_account_completed_refresh_idx" ON "SmarterMailStatsFolderState"("emailAccountId", "completedAt", "nextRefreshAt");
ALTER TABLE "SmarterMailStatsFolderState" ADD CONSTRAINT "SmarterMailStatsFolderState_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SmarterMailStatsUid" (
  "emailAccountId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "uid" BIGINT NOT NULL,
  "folderGuid" TEXT,
  "generation" TEXT NOT NULL,
  "needsImport" BOOLEAN NOT NULL DEFAULT false,
  "removedAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  CONSTRAINT "SmarterMailStatsUid_pkey" PRIMARY KEY ("emailAccountId", "folderId", "uid")
);
CREATE INDEX "SmarterMailStatsUid_account_folder_import_idx" ON "SmarterMailStatsUid"("emailAccountId", "folderId", "needsImport");
CREATE INDEX "SmarterMailStatsUid_account_folder_generation_idx" ON "SmarterMailStatsUid"("emailAccountId", "folderId", "generation", "removedAt");
ALTER TABLE "SmarterMailStatsUid" ADD CONSTRAINT "SmarterMailStatsUid_folder_fkey" FOREIGN KEY ("emailAccountId", "folderId") REFERENCES "SmarterMailStatsFolderState"("emailAccountId", "folderId") ON DELETE CASCADE;

ALTER TABLE "EmailMessage" ADD COLUMN "metadataVersion" TEXT NOT NULL DEFAULT '', ADD COLUMN "subject" TEXT, ADD COLUMN "rfcMessageId" TEXT;
DROP INDEX "EmailMessage_emailAccountId_threadId_messageId_key";
CREATE UNIQUE INDEX "EmailMessage_account_thread_message_version_key" ON "EmailMessage"("emailAccountId", "threadId", "messageId", "metadataVersion");
ALTER TABLE "EmailMessage" ADD COLUMN "providerFolderGuid" TEXT, ADD COLUMN "providerUid" BIGINT;
CREATE INDEX "EmailMessage_account_folder_uid_removed_idx" ON "EmailMessage"("emailAccountId", "providerFolderId", "providerUid", "removedAt");
