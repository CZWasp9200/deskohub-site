import {
  isWorkspaceE2EReferralCaseId,
  workspaceE2ECasePoolOrder,
} from "./case-catalog";
import { registerWorkspaceE2ECases, test } from "./fixtures";

test.describe("workspace checkout", () => {
  registerWorkspaceE2ECases(workspaceE2ECasePoolOrder, {
    // Referral cases and the paid guest referral case bind their run-scoped
    // synthetic identities; every other case runs as planned.
    bindCase: async (input) => {
      if (isWorkspaceE2EReferralCaseId(input.testCase.id)) {
        const { bindWorkspaceE2EReferralCase } = await import(
          "../referrals/cases"
        );
        return bindWorkspaceE2EReferralCase(input);
      }
      const { bindGuestReferralPaymentCase } = await import(
        "../cases/guest-referral-payment"
      );
      return bindGuestReferralPaymentCase(input);
    },
  });
});
