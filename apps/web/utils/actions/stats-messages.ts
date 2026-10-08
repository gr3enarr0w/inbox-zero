import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { Prisma } from "@/generated/prisma/client";
import { isDefined, type ParsedMessage } from "@/utils/types";
import {
  extractDomainFromEmail,
  extractEmailAddress,
  extractNameFromEmail,
} from "@/utils/email";
import { internalDateToDate } from "@/utils/date";
import { parseSmarterMailMessageId } from "@/utils/smartermail/message";
import { findUnsubscribeLink } from "@/utils/parse/parseHtml.server";
import {
  cleanUnsubscribeLink,
  parseListUnsubscribeHeader,
} from "@/utils/parse/unsubscribe";

export async function saveParsedEmailMessages(
  emailAccountId: string,
  messages: ParsedMessage[],
  logger: Logger,
  statsImport?: {
    generation: string;
    leaseToken: string;
    folderId?: string;
    folderGuid?: string | null;
  },
) {
  const emailsToSave = messages
    .map((m) => {
      const unsubscribeLink = mergeUnsubscribeSources({
        htmlUnsubscribeLink: findUnsubscribeLink(m.textHtml),
        listUnsubscribeHeader: m.headers["list-unsubscribe"],
      });

      const date = internalDateToDate(m.internalDate);
      if (!date) {
        logger.error("No date for email", {
          messageId: m.id,
          date: m.internalDate,
        });
        return;
      }

      return {
        threadId: m.threadId,
        messageId: m.id,
        metadataVersion: statsImport
          ? createHash("sha256")
              .update(
                JSON.stringify([
                  statsImport.folderGuid ?? null,
                  date.toISOString(),
                  extractEmailAddress(m.headers.from).trim().toLowerCase(),
                  m.subject,
                ]),
              )
              .digest("hex")
          : "",
        subject: m.subject,
        rfcMessageId: m.headers["message-id"] ?? null,
        providerUid: statsImport?.folderId
          ? BigInt(parseSmarterMailMessageId(m.id).uid)
          : null,
        from: extractEmailAddress(m.headers.from),
        fromName: extractNameFromEmail(m.headers.from),
        fromDomain: extractDomainFromEmail(m.headers.from),
        to: m.headers.to ? extractEmailAddress(m.headers.to) : "Missing",
        date,
        unsubscribeLink,
        read: !m.labelIds?.includes("UNREAD"),
        sent: !!m.labelIds?.includes("SENT"),
        draft: !!m.labelIds?.includes("DRAFT"),
        inbox: !!m.labelIds?.includes("INBOX"),
        emailAccountId,
      };
    })
    .filter(isDefined);

  logger.info("Saving", { count: emailsToSave.length });

  const saved = await saveEmailMessages(emailsToSave, statsImport);
  if (statsImport && saved !== emailsToSave.length)
    throw new Error("Statistics import lost its account lease");
  return saved;
}

async function saveEmailMessages(
  emails: {
    threadId: string;
    messageId: string;
    metadataVersion: string;
    subject: string;
    rfcMessageId: string | null;
    providerUid: bigint | null;
    from: string;
    fromName: string;
    fromDomain: string;
    to: string;
    date: Date;
    unsubscribeLink: string | null | undefined;
    read: boolean;
    sent: boolean;
    draft: boolean;
    inbox: boolean;
    emailAccountId: string;
  }[],
  statsImport?: {
    generation: string;
    leaseToken: string;
    folderId?: string;
    folderGuid?: string | null;
  },
) {
  if (emails.length === 0) return 0;

  const rows = emails.map(
    (email) => Prisma.sql`(
      ${randomUUID()}::text,
      ${email.emailAccountId}::text,
      ${email.threadId}::text,
      ${email.messageId}::text,
      ${email.metadataVersion}::text,
      ${email.subject}::text,
      ${email.rfcMessageId}::text,
      ${email.date}::timestamp,
      ${email.from}::text,
      ${email.fromName}::text,
      ${email.fromDomain}::text,
      ${email.to}::text,
      ${email.unsubscribeLink}::text,
      ${email.read}::boolean,
      ${email.sent}::boolean,
      ${email.draft}::boolean,
      ${email.inbox}::boolean,
      ${statsImport?.generation ?? null}::text,
      ${statsImport?.folderId ?? null}::text,
      ${statsImport?.folderGuid ?? null}::text,
      ${email.providerUid}::bigint,
      NULL::timestamp,
      NOW(),
      NOW(),
      NOW()
    )`,
  );

  return prisma.$executeRaw`
    WITH owned_state AS (
      ${
        statsImport
          ? Prisma.sql`SELECT "emailAccountId" FROM "SmarterMailStatsImportState"
        WHERE "emailAccountId" = ${emails[0].emailAccountId}
          ${
            statsImport.folderId
              ? Prisma.sql`AND EXISTS (
            SELECT 1 FROM "SmarterMailStatsFolderState" folder
            WHERE folder."emailAccountId" = "SmarterMailStatsImportState"."emailAccountId"
              AND folder."folderId" = ${statsImport.folderId}
              AND folder."generation" = ${statsImport.generation}
          )`
              : Prisma.sql`AND "generation" = ${statsImport.generation}`
          }
          AND "leaseToken" = ${statsImport.leaseToken}
          AND "leaseUntil" > NOW()
        FOR UPDATE`
          : Prisma.sql`SELECT NULL::text AS "emailAccountId"`
      }
    ),
    incoming AS (
      SELECT * FROM (VALUES ${Prisma.join(rows)}) AS imported(
        "id", "emailAccountId", "threadId", "messageId", "metadataVersion", "subject", "rfcMessageId", "date", "from", "fromName",
        "fromDomain", "to", "unsubscribeLink", "read", "sent", "draft", "inbox",
        "smarterMailStatsGeneration", "providerFolderId", "providerFolderGuid", "providerUid", "removedAt", "lastCheckedAt", "createdAt", "updatedAt"
      )
    ),
    retired_versions AS (
      UPDATE "EmailMessage" previous SET "removedAt" = NOW(), "updatedAt" = NOW()
      FROM incoming
      WHERE previous."emailAccountId" = incoming."emailAccountId"
        AND previous."threadId" = incoming."threadId"
        AND previous."messageId" = incoming."messageId"
        AND previous."metadataVersion" <> incoming."metadataVersion"
        AND previous."removedAt" IS NULL
        AND ${!!statsImport}::boolean
        AND EXISTS (SELECT 1 FROM owned_state WHERE owned_state."emailAccountId" = incoming."emailAccountId")
      RETURNING previous."id"
    )
    INSERT INTO "EmailMessage" (
      "id",
      "emailAccountId",
      "threadId",
      "messageId",
      "metadataVersion",
      "subject",
      "rfcMessageId",
      "date",
      "from",
      "fromName",
      "fromDomain",
      "to",
      "unsubscribeLink",
      "read",
      "sent",
      "draft",
      "inbox",
      "smarterMailStatsGeneration",
      "providerFolderId",
      "providerFolderGuid",
      "providerUid",
      "removedAt",
      "lastCheckedAt",
      "createdAt",
      "updatedAt"
    )
    SELECT * FROM incoming AS imported
    WHERE ${
      statsImport
        ? Prisma.sql`EXISTS (
      SELECT 1 FROM owned_state WHERE owned_state."emailAccountId" = imported."emailAccountId"
    )`
        : Prisma.sql`TRUE`
    }
    ON CONFLICT ("emailAccountId", "threadId", "messageId", "metadataVersion") DO UPDATE SET
      "date" = EXCLUDED."date",
      "from" = EXCLUDED."from",
      "fromName" = COALESCE(NULLIF(EXCLUDED."fromName", ''), "EmailMessage"."fromName"),
      "fromDomain" = EXCLUDED."fromDomain",
      "to" = CASE WHEN EXCLUDED."to" = 'Missing' THEN "EmailMessage"."to" ELSE EXCLUDED."to" END,
      "subject" = COALESCE(EXCLUDED."subject", "EmailMessage"."subject"),
      "rfcMessageId" = COALESCE(EXCLUDED."rfcMessageId", "EmailMessage"."rfcMessageId"),
      "unsubscribeLink" = COALESCE(EXCLUDED."unsubscribeLink", "EmailMessage"."unsubscribeLink"),
      "read" = EXCLUDED."read",
      "sent" = EXCLUDED."sent",
      "draft" = EXCLUDED."draft",
      "inbox" = EXCLUDED."inbox",
      "smarterMailStatsGeneration" = COALESCE(EXCLUDED."smarterMailStatsGeneration", "EmailMessage"."smarterMailStatsGeneration"),
      "providerFolderId" = COALESCE(EXCLUDED."providerFolderId", "EmailMessage"."providerFolderId"),
      "providerFolderGuid" = COALESCE(EXCLUDED."providerFolderGuid", "EmailMessage"."providerFolderGuid"),
      "providerUid" = COALESCE(EXCLUDED."providerUid", "EmailMessage"."providerUid"),
      "removedAt" = NULL,
      "lastCheckedAt" = NOW(),
      "updatedAt" = NOW()
  `;
}

function mergeUnsubscribeSources({
  htmlUnsubscribeLink,
  listUnsubscribeHeader,
}: {
  htmlUnsubscribeLink?: string | null;
  listUnsubscribeHeader?: string | null;
}) {
  if (!listUnsubscribeHeader) return cleanUnsubscribeLink(htmlUnsubscribeLink);

  const normalizedHtmlLink = cleanUnsubscribeLink(htmlUnsubscribeLink);
  if (!normalizedHtmlLink) return listUnsubscribeHeader;

  const headerLinks = parseListUnsubscribeHeader(listUnsubscribeHeader);
  if (headerLinks.includes(normalizedHtmlLink)) return listUnsubscribeHeader;

  return `${listUnsubscribeHeader}, <${normalizedHtmlLink}>`;
}
