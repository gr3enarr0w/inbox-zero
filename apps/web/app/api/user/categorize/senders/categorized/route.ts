import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withEmailAccount } from "@/utils/middleware";
import { getUserCategoriesWithRules } from "@/utils/category.server";

export type CategorizedSendersResponse = Awaited<
  ReturnType<typeof getCategorizedSenders>
>;

async function getCategorizedSenders({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const activeSenders = await getActiveSenderIds(emailAccountId);
  const [senders, categories, emailAccount] = await Promise.all([
    prisma.newsletter.findMany({
      where: {
        emailAccountId,
        id: { in: activeSenders.map((sender) => sender.id) },
      },
      select: {
        id: true,
        email: true,
        name: true,
        category: { select: { id: true, description: true, name: true } },
      },
    }),
    getUserCategoriesWithRules({ emailAccountId }),
    prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      select: { autoCategorizeSenders: true },
    }),
  ]);

  return {
    senders,
    categories,
    autoCategorizeSenders: emailAccount?.autoCategorizeSenders ?? false,
  };
}

export const GET = withEmailAccount(
  "user/categorize/senders/categorized",
  async (request) => {
    const emailAccountId = request.auth.emailAccountId;
    const result = await getCategorizedSenders({ emailAccountId });
    return NextResponse.json(result);
  },
);

async function getActiveSenderIds(emailAccountId: string) {
  return prisma.$queryRaw<{ id: string }[]>`
    SELECT n."id" FROM "Newsletter" n
    WHERE n."emailAccountId" = ${emailAccountId}
      AND EXISTS (
        SELECT 1 FROM "EmailMessage" m
        WHERE m."emailAccountId" = n."emailAccountId"
          AND LOWER(m."from") = LOWER(n."email")
          AND m."sent" = false AND m."draft" = false
          AND m."removedAt" IS NULL
          AND LOWER(m."from") <> (
            SELECT LOWER("email") FROM "EmailAccount" WHERE "id" = ${emailAccountId}
          )
      )
  `;
}
