ALTER TABLE "SmarterMailSyncState" ADD COLUMN "retryAt" TIMESTAMP(3);

UPDATE "SmarterMailSyncState" SET "retryAt" = "nextRunAt" WHERE "failures" > 0;
