CREATE TABLE "ThunderbirdSyncState" (
    "emailAccountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cursor" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ThunderbirdSyncState_pkey" PRIMARY KEY ("emailAccountId")
);
CREATE TABLE "ThunderbirdSyncMessage" (
    "emailAccountId" TEXT NOT NULL,
    "messageKey" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "ThunderbirdSyncMessage_pkey" PRIMARY KEY ("emailAccountId", "messageKey")
);
CREATE INDEX "ThunderbirdSyncState_enabled_nextRunAt_idx" ON "ThunderbirdSyncState"("enabled", "nextRunAt");
CREATE INDEX "ThunderbirdSyncMessage_emailAccountId_status_idx" ON "ThunderbirdSyncMessage"("emailAccountId", "status");
ALTER TABLE "ThunderbirdSyncState" ADD CONSTRAINT "ThunderbirdSyncState_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThunderbirdSyncMessage" ADD CONSTRAINT "ThunderbirdSyncMessage_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
