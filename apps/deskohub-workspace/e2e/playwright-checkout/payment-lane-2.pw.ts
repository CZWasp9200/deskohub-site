import { workspaceE2EPaymentCaseLanes } from "./case-catalog";
import { registerWorkspaceE2ECases, test } from "./fixtures";

test.describe("workspace checkout payment lane 2", () => {
  registerWorkspaceE2ECases(workspaceE2EPaymentCaseLanes[1], {
    bindCase: async (input) => {
      const { bindGuestReferralPaymentCase } = await import(
        "../cases/guest-referral-payment"
      );
      return bindGuestReferralPaymentCase(input);
    },
    serial: true,
  });
});
