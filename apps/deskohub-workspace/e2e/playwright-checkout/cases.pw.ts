import { workspaceE2ECasePoolOrder } from "./case-catalog";
import { registerWorkspaceE2ECases, test } from "./fixtures";

test.describe("workspace checkout", () => {
  registerWorkspaceE2ECases(workspaceE2ECasePoolOrder);
});
