import { makeEmailConfigLayer } from "@deskohub/email";
import { Config } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";

export const workspaceDefaultFromAddress = "reservations@workspace.deskohub.cz";

export const EmailConfigLayer = makeEmailConfigLayer(
  Config.succeed({
    email: workspaceDefaultFromAddress,
    name: workspaceSiteConstants.brand.name,
  })
);
