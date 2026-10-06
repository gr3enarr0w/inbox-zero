CREATE TABLE "SmarterMailSyncState" (
 "emailAccountId" TEXT NOT NULL PRIMARY KEY,
 "enabled" BOOLEAN NOT NULL DEFAULT false,
 "cursor" TEXT,
 "failures" INTEGER NOT NULL DEFAULT 0,
 "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMP(3),
 "leaseToken" TEXT,
 "lastSyncedAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SmarterMailSyncState_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SmarterMailSyncState_enabled_nextRunAt_idx" ON "SmarterMailSyncState"("enabled", "nextRunAt");
CREATE TABLE "SmarterMailSyncMessage" (
 "emailAccountId" TEXT NOT NULL,
 "messageKey" TEXT NOT NULL,
 "messageId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'claimed',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "processedAt" TIMESTAMP(3),
 PRIMARY KEY ("emailAccountId", "messageKey"),
 CONSTRAINT "SmarterMailSyncMessage_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SmarterMailSyncMessage_emailAccountId_status_idx" ON "SmarterMailSyncMessage"("emailAccountId", "status");
