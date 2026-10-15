import { HttpApi } from "effect/unstable/httpapi";
import { AdminCliCampaignsApi } from "./email-campaigns";
import { AdminCliAdministrationApi, AdminCliApi } from "./workspace-admin-api";

export const WorkspaceAdminApi = HttpApi.make("workspaceAdminApi")
  .add(AdminCliApi)
  .add(AdminCliAdministrationApi)
  .add(AdminCliCampaignsApi);
