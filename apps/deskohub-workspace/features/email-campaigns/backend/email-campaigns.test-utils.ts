import type { AudienceFilter } from "../audience-filter";
import type { CampaignLocalizedContent } from "../body/campaign-content";

export const everyoneFilter: AudienceFilter = {
  _tag: "Group",
  operator: "and",
  filters: [],
};

/** Czech-only campaign content whose body is one paragraph of `text`. */
export const campaignContentFixture = (
  text = "Ahoj"
): CampaignLocalizedContent => ({
  "cs-CZ": {
    subject: "Novinky",
    preheader: "Co je nového",
    body: {
      formatVersion: 1,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    },
  },
});
