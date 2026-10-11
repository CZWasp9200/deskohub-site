import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type {
  PreloadedWorkspaceAvailability,
  WorkspaceAvailability,
  WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const loadWorkspaceAvailability = mock(
  (_input: {
    readonly query: WorkspaceAvailabilityQuery;
  }): Promise<WorkspaceAvailability> => new Promise(() => undefined)
);

mock.module("@/features/reservation/workspace-availability-client", () => ({
  loadWorkspaceAvailability,
}));

const { useReservationAvailability } = await import(
  "./use-reservation-availability"
);

const query = {
  kind: "cowork",
  from: "2099-07-30",
  to: "2099-07-30",
  entryTier: "open-space",
  date: "2099-07-30",
} satisfies WorkspaceAvailabilityQuery;

const availability = {
  date: "2099-07-30",
  from: "2099-07-30",
  to: "2099-07-30",
  unavailableDates: ["2099-07-30"],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
} satisfies WorkspaceAvailability;

const AvailabilityHarness = ({
  initialAvailability,
  query: harnessQuery,
}: {
  readonly initialAvailability: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly query: WorkspaceAvailabilityQuery;
}) => {
  const result = useReservationAvailability(harnessQuery, {
    initialAvailability,
    replacementToken: "sealed-replacement",
  });
  return (
    <output data-pending={String(result.isPending)} data-testid="availability">
      {result.availability?.unavailableDates.join(",") ?? "none"}
    </output>
  );
};

const renderHarness = (props: Parameters<typeof AvailabilityHarness>[0]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AvailabilityHarness {...props} />
    </QueryClientProvider>
  );

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  loadWorkspaceAvailability.mockImplementation(
    () => new Promise(() => undefined)
  );
});

afterEach(() => {
  cleanup();
  loadWorkspaceAvailability.mockClear();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("renders preloaded availability for a matching query without fetching", () => {
  const view = renderHarness({
    // Key order differs from the query; the query key hash ignores it.
    initialAvailability: [
      {
        query: { ...query, date: "2099-07-30", kind: "cowork" },
        availability,
        loadedAt: Date.now(),
      },
    ],
    query,
  });

  const output = view.getByTestId("availability");
  expect(output.textContent).toBe("2099-07-30");
  expect(output.dataset.pending).toBe("false");
  expect(loadWorkspaceAvailability).not.toHaveBeenCalled();
});

test("keeps a fresh page-loaded seed through the initial mount", async () => {
  const view = renderHarness({
    initialAvailability: [{ query, availability, loadedAt: Date.now() }],
    query,
  });

  // Mount effects and any scheduled fetch run before this settles.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(view.getByTestId("availability").dataset.pending).toBe("false");
  expect(loadWorkspaceAvailability).not.toHaveBeenCalled();
});

test("fetches a query the page did not preload", async () => {
  const view = renderHarness({
    initialAvailability: [
      {
        query: { ...query, entryTier: "reserved-desk" },
        availability,
        loadedAt: Date.now(),
      },
    ],
    query,
  });

  expect(view.getByTestId("availability").textContent).toBe("none");
  expect(view.getByTestId("availability").dataset.pending).toBe("true");
  await waitFor(() =>
    expect(loadWorkspaceAvailability).toHaveBeenCalledTimes(1)
  );
  expect(loadWorkspaceAvailability.mock.calls[0]?.[0].query).toEqual(query);
});

test("refreshes stale preloaded availability while still rendering it", async () => {
  const view = renderHarness({
    initialAvailability: [
      { query, availability, loadedAt: Date.now() - 60_000 },
    ],
    query,
  });

  expect(view.getByTestId("availability").textContent).toBe("2099-07-30");
  expect(view.getByTestId("availability").dataset.pending).toBe("false");
  await waitFor(() =>
    expect(loadWorkspaceAvailability).toHaveBeenCalledTimes(1)
  );
});
