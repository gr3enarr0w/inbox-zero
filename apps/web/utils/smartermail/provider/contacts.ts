import { z } from "zod";
import { normalizeContactCandidates } from "@/utils/email/contact";
import { SmarterMailConversationsProvider } from "@/utils/smartermail/provider/conversations";

const sourcesSchema = z.object({
  sharedLists: z.array(
    z.object({
      enabled: z.boolean(),
      ownerUsername: z.string(),
      itemID: z.string(),
      displayName: z.string(),
      isSharedItem: z.boolean().optional(),
      isDomainResource: z.boolean().optional(),
    }),
  ),
});
const contactsSchema = z.object({
  results: z.array(
    z.object({ displayAs: z.string(), emailAddressList: z.array(z.string()) }),
  ),
});

export class SmarterMailContactsProvider extends SmarterMailConversationsProvider {
  async searchContacts(query: string) {
    const sources = sourcesSchema.parse(
      await this.client.request("contactSources"),
    );
    const owned = sources.sharedLists.filter(
      (source) =>
        source.enabled && !source.isSharedItem && !source.isDomainResource,
    );
    if (!owned.length) return [];
    const response = contactsSchema.parse(
      await this.client.request("contacts", {
        sources: owned.map((source) => ({
          owner: source.ownerUsername,
          id: source.itemID,
          sourceName: source.displayName,
        })),
        searchParams: {
          search: query,
          skip: 0,
          take: 10,
          showNonCategorized: true,
          getImages: false,
        },
      }),
    );
    return normalizeContactCandidates(
      response.results.flatMap((contact) =>
        contact.emailAddressList.map((emailAddress) => ({
          emailAddress,
          name: contact.displayAs,
        })),
      ),
    );
  }
}
