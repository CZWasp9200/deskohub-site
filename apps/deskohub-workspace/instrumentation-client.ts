import "./shared/polyfills/temporal";

import { initBotId } from "botid/client/core";
import { getClientEnv } from "./client-env";
import { initializeWorkspaceBotId } from "./shared/bot-protection/bot-protection.policy.js";

initializeWorkspaceBotId(getClientEnv().NEXT_PUBLIC_VERCEL_ENV, () =>
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
      // Verified in the Better Auth guard: always for code sign-in, and for
      // sign-in emails while sign-in codes are on.
      {
        path: "/api/auth/sign-in/magic-link",
        method: "POST",
      },
      {
        path: "/api/auth/sign-in/email-otp",
        method: "POST",
      },
    ],
  })
);
