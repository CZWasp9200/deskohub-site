import { testEmailAddress } from "@deskohub/email/testing";

const unavailableError = {
  message: "Unavailable in component renderer",
  status: 503,
} as const;

export const authClient = {
  getSession: async () => ({
    data: {
      session: { id: "synthetic-session" },
      user: { id: "synthetic-user", email: testEmailAddress("ada") },
    },
    error: null,
  }),
  signIn: {
    magicLink: async () => ({ error: unavailableError }),
  },
  signOut: async () => ({ error: unavailableError }),
};
