CREATE TABLE "SmarterMailStatsImportState" (
    "emailAccountId" TEXT NOT NULL,
    "cursor" TEXT,
    "generation" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'scan',
    "after" TIMESTAMP(3),
    "before" TIMESTAMP(3) NOT NULL,
    "historyComplete" BOOLEAN NOT NULL DEFAULT false,
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
