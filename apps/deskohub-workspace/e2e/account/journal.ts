import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { workspaceDir } from "../runtime";

const journalRoot = resolve(
  workspaceDir,
  "e2e-artifacts",
  "checkout",
  "cleanup-journals"
);
const formatVersion = 1;
export const workspaceE2EAccountLaneId = "account-lane";

/**
 * The owner of one account identity journal: the serial account lane, or one
 * referral-lane case whose synthetic identities never cross into another case.
 */
export type WorkspaceE2EAccountJournalOwnerId = string;

const ownerIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const journalPath = (ownerId: WorkspaceE2EAccountJournalOwnerId) => {
  if (!ownerIdPattern.test(ownerId)) {
    throw new Error("Invalid workspace E2E account journal owner");
  }
  return resolve(journalRoot, `${ownerId}.json`);
};

/**
 * Ownership unit for synthetic account identities: every synthetic provider
 * and identity row the owner created is journaled here by exact ID as soon as
 * it exists, so the suite cleanup reconciles it even after an interrupted
 * case. The journal never contains recipients, message bodies, URLs,
 * tokens, or cookies.
 */
export type WorkspaceE2EAccountJournal = {
  /** Exact Better Auth user rows; deletion cascades sessions, accounts, and links. */
  readonly authUserIds: readonly string[];
  readonly completed: boolean;
  /** Exact synthetic Dotypos profiles; finalizers expire, never delete. */
  readonly dotyposCustomerIds: readonly string[];
  /** Exact synthetic Dotypos reservations; finalizers cancel and converge. */
  readonly dotyposReservationIds: readonly string[];
  readonly laneId: WorkspaceE2EAccountJournalOwnerId;
  readonly startedAt: string;
  readonly version: typeof formatVersion;
};

export const emptyWorkspaceE2EAccountJournal = (
  ownerId: WorkspaceE2EAccountJournalOwnerId = workspaceE2EAccountLaneId
): WorkspaceE2EAccountJournal => ({
  authUserIds: [],
  completed: false,
  dotyposCustomerIds: [],
  dotyposReservationIds: [],
  laneId: ownerId,
  startedAt: new Date().toISOString(),
  version: formatVersion,
});

export const writeWorkspaceE2EAccountJournal = async (
  journal: WorkspaceE2EAccountJournal
) => {
  await mkdir(journalRoot, { recursive: true });
  const path = journalPath(journal.laneId);
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
};

export const readWorkspaceE2EAccountJournal = async (
  ownerId: WorkspaceE2EAccountJournalOwnerId = workspaceE2EAccountLaneId
): Promise<WorkspaceE2EAccountJournal | undefined> => {
  try {
    return parseWorkspaceE2EAccountJournal(
      await readFile(journalPath(ownerId), "utf8"),
      ownerId
    );
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
};

export const parseWorkspaceE2EAccountJournal = (
  serialized: string,
  ownerId: WorkspaceE2EAccountJournalOwnerId = workspaceE2EAccountLaneId
): WorkspaceE2EAccountJournal => {
  const value: unknown = JSON.parse(serialized);
  if (
    !isRecord(value) ||
    value.version !== formatVersion ||
    value.laneId !== ownerId ||
    typeof value.startedAt !== "string" ||
    typeof value.completed !== "boolean" ||
    !isStringArray(value.authUserIds) ||
    !isStringArray(value.dotyposCustomerIds) ||
    !isStringArray(value.dotyposReservationIds)
  ) {
    throw new Error("Invalid workspace E2E account journal");
  }
  return {
    authUserIds: value.authUserIds,
    completed: value.completed,
    dotyposCustomerIds: value.dotyposCustomerIds,
    dotyposReservationIds: value.dotyposReservationIds,
    laneId: value.laneId,
    startedAt: value.startedAt,
    version: value.version,
  } satisfies WorkspaceE2EAccountJournal;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
