import { createHash, randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  readFile,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { Context, Effect, Layer, Schedule } from "effect";
import { toWorkspaceE2EError, type WorkspaceE2EError } from "../errors";
import { log, workspaceDir } from "../runtime";
import { E2ERunContextService } from "../services/telemetry";

// Unbounded hosted sessions produced Nexi sandbox error pages; three per suite
// is the measured operating bound, not a provider guarantee.
const workspaceE2EHostedPaymentConcurrency = 3;

export interface WorkspaceE2EHostedPaymentPermit {
  /**
   * Runs one Nexi hosted-payment session, from payment submission through the
   * return or terminal state, while holding one of the run's hosted slots.
   */
  readonly withPermit: <A, E, R>(
    operation: string,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | WorkspaceE2EError, R>;
}

export type WorkspaceE2EHostedPaymentPermitOptions = {
  readonly capacity: number;
  readonly directory: string;
  readonly heartbeatIntervalMs: number;
  readonly leaseMs: number;
  readonly pollIntervalMs: number;
};

const defaultOptions = {
  capacity: workspaceE2EHostedPaymentConcurrency,
  heartbeatIntervalMs: 5_000,
  // Twelve missed heartbeats: only a frozen or recycled holder process gets
  // this far, because a crashed holder is reclaimed by its exit.
  leaseMs: 60_000,
  pollIntervalMs: 250,
} as const;

/**
 * Playwright runs cases in separate worker processes, so the hosted-payment
 * bound is a FIFO ticket queue in the run's artifact directory: every
 * worker of one run shares it, and other runs never see it.
 */
export class WorkspaceE2EHostedPaymentPermitService extends Context.Service<
  WorkspaceE2EHostedPaymentPermitService,
  WorkspaceE2EHostedPaymentPermit
>()("WorkspaceE2E/HostedPaymentPermitService") {
  static layer = (
    options: Partial<WorkspaceE2EHostedPaymentPermitOptions> &
      Pick<WorkspaceE2EHostedPaymentPermitOptions, "directory">
  ) =>
    Layer.sync(this, () =>
      makeHostedPaymentPermit({ ...defaultOptions, ...options })
    );

  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { value: runContext } = yield* E2ERunContextService;
      return makeHostedPaymentPermit({
        ...defaultOptions,
        directory: resolve(
          workspaceDir,
          "e2e-artifacts",
          "checkout",
          "hosted-payment-permit",
          createHash("sha256")
            .update(runContext.runId)
            .digest("hex")
            .slice(0, 32)
        ),
      });
    })
  );
}

type Ticket = {
  readonly directory: string;
  readonly number: number;
  readonly path: string;
  readonly token: string;
};

type TicketOwner = {
  readonly pid: number;
  readonly token: string;
};

// Tokens of the tickets this process still owns. A ticket naming this process
// whose token is missing was leaked by an earlier holder, so it is inactive.
const processTicketTokens = new Set<string>();

function makeHostedPaymentPermit(
  options: WorkspaceE2EHostedPaymentPermitOptions
): WorkspaceE2EHostedPaymentPermit {
  // Released and exited tickets never become active again.
  const inactiveTickets = new Set<string>();
  const owners = new Map<string, TicketOwner>();

  const isActive = (ticket: Ticket, number: number) =>
    Effect.tryPromise({
      catch: (cause) =>
        toWorkspaceE2EError("read hosted payment permit queue", cause),
      try: async () => {
        const path = ticketPath(ticket.directory, number);
        if (inactiveTickets.has(path)) return false;
        if (await exists(releasePath(ticket.directory, number))) {
          inactiveTickets.add(path);
          return false;
        }
        let owner = owners.get(path);
        if (!owner) {
          owner = JSON.parse(await readFile(path, "utf8")) as TicketOwner;
          owners.set(path, owner);
        }
        const ownerActive =
          owner.pid === process.pid
            ? processTicketTokens.has(owner.token)
            : isProcessAlive(owner.pid);
        if (!ownerActive) {
          inactiveTickets.add(path);
          return false;
        }
        const { mtimeMs } = await stat(path);
        return Date.now() - mtimeMs <= options.leaseMs;
      },
    });

  // Untraced: a waiter polls this every few hundred milliseconds.
  const isAdmitted = Effect.fnUntraced(function* (ticket: Ticket) {
    let active = 0;
    for (let number = 0; number < ticket.number; number += 1) {
      if (yield* isActive(ticket, number)) active += 1;
      if (active >= options.capacity) return false;
    }
    return true;
  });

  return {
    withPermit: (operation, effect) =>
      Effect.scoped(
        Effect.gen(function* () {
          const ticket = yield* Effect.acquireRelease(
            allocateTicket(options.directory),
            releaseTicket
          );
          yield* Effect.forkScoped(
            heartbeat(ticket).pipe(
              Effect.repeat(
                Schedule.spaced(`${options.heartbeatIntervalMs} millis`)
              )
            )
          );
          const waitStartedAt = Date.now();
          yield* isAdmitted(ticket).pipe(
            Effect.repeat({
              schedule: Schedule.spaced(`${options.pollIntervalMs} millis`),
              until: (admitted) => admitted,
            })
          );
          const waitedSeconds = (Date.now() - waitStartedAt) / 1_000;
          log(
            `HOSTED PAYMENT PERMIT ${operation} admitted after ${waitedSeconds.toFixed(1)}s (ticket ${ticket.number})`
          );
          return yield* effect;
        })
      ),
  };
}

// Ticket numbers are dense from zero and never reused within a run: a hard
// link publishes the complete owner record atomically and fails on an
// existing number, so a ticket always sorts after every ticket that existed
// before it.
const allocateTicket = (directory: string) =>
  Effect.tryPromise({
    catch: (cause) =>
      toWorkspaceE2EError("allocate hosted payment permit ticket", cause),
    try: async (): Promise<Ticket> => {
      await mkdir(directory, { recursive: true });
      const token = randomUUID();
      const draftPath = join(directory, `draft-${token}`);
      const owner: TicketOwner = { pid: process.pid, token };
      await writeFile(draftPath, JSON.stringify(owner), { mode: 0o600 });
      processTicketTokens.add(token);
      try {
        for (let number = 0; ; number += 1) {
          const path = ticketPath(directory, number);
          try {
            await link(draftPath, path);
            return { directory, number, path, token };
          } catch (cause) {
            if (errorCode(cause) !== "EEXIST") throw cause;
          }
        }
      } catch (cause) {
        processTicketTokens.delete(token);
        throw cause;
      } finally {
        await unlink(draftPath).catch(() => undefined);
      }
    },
  });

const releaseTicket = (ticket: Ticket) =>
  Effect.tryPromise({
    catch: (cause) =>
      toWorkspaceE2EError("release hosted payment permit ticket", cause),
    try: () =>
      writeFile(releasePath(ticket.directory, ticket.number), "", {
        flag: "wx",
        mode: 0o600,
      }).catch((cause: unknown) => {
        if (errorCode(cause) !== "EEXIST") throw cause;
      }),
  }).pipe(
    // Forgetting the token alone makes the ticket inactive for this process;
    // other processes fall back to the heartbeat lease.
    Effect.ensuring(
      Effect.sync(() => {
        processTicketTokens.delete(ticket.token);
      })
    ),
    Effect.catch((error) => Effect.sync(() => log(error.message)))
  );

const heartbeat = (ticket: Ticket) =>
  Effect.tryPromise(() => {
    const now = new Date();
    return utimes(ticket.path, now, now);
  }).pipe(Effect.ignore);

const ticketPath = (directory: string, number: number) =>
  join(directory, `ticket-${String(number).padStart(6, "0")}`);

const releasePath = (directory: string, number: number) =>
  join(directory, `released-${String(number).padStart(6, "0")}`);

const exists = (path: string) =>
  access(path).then(
    () => true,
    (cause: unknown) => {
      if (errorCode(cause) === "ENOENT") return false;
      throw cause;
    }
  );

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM means the process exists under another user.
    return errorCode(cause) !== "ESRCH";
  }
};

const errorCode = (cause: unknown) =>
  cause instanceof Error && "code" in cause ? cause.code : undefined;
