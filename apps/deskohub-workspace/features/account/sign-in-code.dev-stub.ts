/**
 * TEMPORARY development stub for the code-entry look-and-feel round (#603).
 * Delete this file and its call sites in `auth-return.ts` once the server work
 * (#604) issues and verifies real sign-in codes.
 *
 * Set `NEXT_PUBLIC_SIGN_IN_CODE_STUB=on` to fake an issued code, or `off` to
 * fake a response without one (flag off). It never runs in production builds
 * and skips the network entirely. Typed codes pick the verification outcome:
 * 000000 invalid, 111111 expired, 222222 too many attempts, anything else
 * signs in.
 */
const stubMode =
  process.env.NODE_ENV === "production"
    ? undefined
    : process.env.NEXT_PUBLIC_SIGN_IN_CODE_STUB;

const stubbedErrorCodes: Readonly<Record<string, string>> = {
  "000000": "INVALID_OTP",
  "111111": "OTP_EXPIRED",
  "222222": "TOO_MANY_ATTEMPTS",
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const signInCodeDevStub =
  stubMode === "on" || stubMode === "off"
    ? {
        sendMagicLink: async () => {
          await wait(700);
          return {
            data: { status: true, signInCode: stubMode === "on" },
            error: null,
          };
        },
        verifyCode: async (code: string) => {
          await wait(900);
          const errorCode = stubbedErrorCodes[code];
          return errorCode === undefined
            ? { data: { token: "stub" }, error: null }
            : { data: null, error: { code: errorCode } };
        },
      }
    : undefined;
