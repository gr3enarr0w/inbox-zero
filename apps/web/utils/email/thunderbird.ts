import type { EmailProvider } from "@/utils/email/types";
import { ThunderbirdDraftsProvider } from "@/utils/thunderbird/provider/drafts";
import {
  watchThunderbirdEmails,
  unwatchThunderbirdEmails,
} from "@/utils/thunderbird/sync-watch";
export class ThunderbirdProvider
  extends ThunderbirdDraftsProvider
  implements EmailProvider
{
  watchEmails() {
    return watchThunderbirdEmails(this.emailAccountId);
  }
  unwatchEmails() {
    return unwatchThunderbirdEmails(this.emailAccountId);
  }
}
