import { workspaceE2EReferralCaseIds } from "./case-catalog";
import { registerWorkspaceE2ECases, test } from "./fixtures";

test.describe("workspace referral lane", () => {
  registerWorkspaceE2ECases(workspaceE2EReferralCaseIds, {
    bindCase: async (input) => {
      const { bindWorkspaceE2EReferralCase } = await import(
        "../referrals/cases"
      );
      return bindWorkspaceE2EReferralCase(input);
    },
  });
});
