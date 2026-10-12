import "./shared/polyfills/temporal";

import { initBotId } from "botid/client/core";
import { clientEnv } from "./client-env";
import { initializeWorkspaceBotId } from "./shared/bot-protection/bot-protection.policy.js";

initializeWorkspaceBotId(clientEnv.NEXT_PUBLIC_VERCEL_ENV, () =>
  initBotId({
    protect: [
      {
        path: "/*/contact",
        method: "POST",
      },
      {
        path: "/*/reservation/cowork",
        method: "POST",
      },
      {
        path: "/*/reservation/meeting-room",
        method: "POST",
      },
      {
        path: "/*/reservation/office",
        method: "POST",
      },
      {
        path: "/*/checkout/pay",
        method: "POST",
      },
      {
        path: "/*/reservation/invoice/*",
        method: "POST",
      },
    ],
  })
);
