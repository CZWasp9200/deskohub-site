import { Resolver } from "node:dns/promises";
import { domainToASCII } from "node:url";
import { Context, Data, Duration, Effect, Layer } from "effect";

/**
 * Whether a recipient address's domain can receive mail. `rejects_mail` is
 * returned only for a definitive DNS answer; resolver failures and timeouts
 * are `unknown`, so callers can fail open.
 */
export type EmailRecipientDomainStatus =
  | "accepts_mail"
  | "rejects_mail"
  | "unknown";

export type MailDomainRecordType = "MX" | "A" | "AAAA";

/**
 * DNS records a mail domain publishes. MX lookups return exchange host names;
 * an empty or "." exchange is a null MX (RFC 7505).
 */
export interface IMailDomainDns {
  readonly resolve: (
    domain: string,
    type: MailDomainRecordType
  ) => Effect.Effect<readonly string[], DnsLookupError>;
}

export class MailDomainDns extends Context.Service<
  MailDomainDns,
  IMailDomainDns
>()("MailDomainDns") {
  static Live = Layer.sync(this, makeNodeMailDomainDns);
}

export class DnsLookupError extends Data.TaggedError("DnsLookupError")<{
  /** Resolver error code such as `ENOTFOUND` (NXDOMAIN) or `ENODATA`. */
  readonly code?: string;
  readonly cause?: unknown;
}> {}

export interface IEmailRecipientDomainService {
  readonly check: (
    address: string
  ) => Effect.Effect<EmailRecipientDomainStatus>;
}

export class EmailRecipientDomainService extends Context.Service<
  EmailRecipientDomainService,
  IEmailRecipientDomainService
>()("EmailRecipientDomainService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dns = yield* MailDomainDns;

      return {
        check: Effect.fn("EmailRecipientDomainService.check")(function* (
          address: string
        ) {
          const domain = getAsciiDomain(address);
          if (!domain) return "unknown" as const;

          return yield* checkDomain(dns, domain).pipe(
            Effect.timeoutOrElse({
              duration: checkTimeout,
              orElse: () => Effect.succeed("unknown" as const),
            })
          );
        }),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(MailDomainDns.Live));
}

const checkTimeout = Duration.seconds(4);
const lookupTimeoutMilliseconds = 1500;

/** The domain does not exist. */
const noDomainCode = "ENOTFOUND";
/** The domain exists but has no record of the requested type. */
const noRecordsCode = "ENODATA";

/**
 * RFC 5321 section 5.1: deliver to the MX hosts, or to the domain's own
 * address when it publishes no MX records.
 */
const checkDomain = Effect.fn("EmailRecipientDomainService.checkDomain")(
  function* (dns: IMailDomainDns, domain: string) {
    const exchanges = yield* dns.resolve(domain, "MX").pipe(Effect.result);

    if (exchanges._tag === "Success") {
      return exchanges.success.some(isMailExchange)
        ? ("accepts_mail" as const)
        : ("rejects_mail" as const);
    }
    if (exchanges.failure.code === noDomainCode) return "rejects_mail" as const;
    if (exchanges.failure.code !== noRecordsCode) return "unknown" as const;

    const addresses = yield* Effect.all(
      [
        dns.resolve(domain, "A").pipe(Effect.result),
        dns.resolve(domain, "AAAA").pipe(Effect.result),
      ],
      { concurrency: "inherit" }
    );
    if (
      addresses.some(
        (result) => result._tag === "Success" && result.success.length > 0
      )
    ) {
      return "accepts_mail" as const;
    }

    return addresses.every(
      (result) =>
        result._tag === "Success" ||
        result.failure.code === noDomainCode ||
        result.failure.code === noRecordsCode
    )
      ? ("rejects_mail" as const)
      : ("unknown" as const);
  }
);

const isMailExchange = (exchange: string) =>
  exchange !== "" && exchange !== ".";

const getAsciiDomain = (address: string) => {
  const separator = address.lastIndexOf("@");
  if (separator < 0) return undefined;

  const domain = address
    .slice(separator + 1)
    .trim()
    .replace(/\.$/, "");
  return domain ? domainToASCII(domain) || undefined : undefined;
};

function makeNodeMailDomainDns(): IMailDomainDns {
  return {
    resolve: (domain, type) =>
      Effect.tryPromise({
        try: async (signal) => {
          const resolver = new Resolver({
            timeout: lookupTimeoutMilliseconds,
            tries: 2,
          });
          signal.addEventListener("abort", () => resolver.cancel(), {
            once: true,
          });

          switch (type) {
            case "MX":
              return (await resolver.resolveMx(domain)).map(
                (record) => record.exchange
              );
            case "A":
              return await resolver.resolve4(domain);
            case "AAAA":
              return await resolver.resolve6(domain);
          }
        },
        catch: (cause) =>
          new DnsLookupError({
            code: getErrorCode(cause),
            cause,
          }),
      }),
  };
}

const getErrorCode = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  typeof cause.code === "string"
    ? cause.code
    : undefined;
