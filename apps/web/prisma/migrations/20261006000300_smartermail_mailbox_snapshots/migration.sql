CREATE TABLE "SmarterMailMailboxSession" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "emailAccountId" TEXT NOT NULL,
 "folderId" TEXT NOT NULL,
 "after" TIMESTAMP(3) NOT NULL,
 "generation" INTEGER NOT NULL DEFAULT 1,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SmarterMailMailboxSession_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SmarterMailMailboxSession_emailAccountId_updatedAt_idx" ON "SmarterMailMailboxSession"("emailAccountId", "updatedAt");
CREATE TABLE "SmarterMailMailboxMessage" (
 "sessionId" TEXT NOT NULL,
 "messageId" TEXT NOT NULL,
 "generation" INTEGER NOT NULL,
 "missingScans" INTEGER NOT NULL DEFAULT 0,
 "lastMissingGeneration" INTEGER NOT NULL DEFAULT 0,
 "removed" BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY ("sessionId", "messageId"),
 CONSTRAINT "SmarterMailMailboxMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SmarterMailMailboxSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SmarterMailMailboxMessage_sessionId_generation_removed_idx" ON "SmarterMailMailboxMessage"("sessionId", "generation", "removed");
