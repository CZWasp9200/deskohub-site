import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposReservationInterval,
  DotyposService,
} from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import "@/shared/polyfills/temporal";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceProductMonitorOption } from "@/features/reservation/cowork-reservation-product";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import {
  TableAssignmentUnavailableError,
  type WorkspaceTableAssignmentReservation,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";

type DotyposAssignmentTestService = typeof DotyposService.Service;

type MakeCoworkReservationInput =
  | {
      readonly entryTier?: "basic";
      readonly coffee?: boolean;
      readonly date?: string;
    }
  | {
      readonly entryTier: "open-space";
      readonly coffee?: boolean;
      readonly date?: string;
    }
  | {
      readonly entryTier: "reserved-desk";
      readonly date?: string;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    }
  | { readonly entryTier: "plus"; readonly date?: string }
  | {
      readonly entryTier: "profi";
      readonly date?: string;
      readonly monitorOption: WorkspaceProductMonitorOption;
    };

const makeReservation = (
  input: MakeCoworkReservationInput = {}
): WorkspaceTableAssignmentReservation => {
  const date = input.date ?? "2099-06-10";

  if (input.entryTier === "open-space") {
    return {
      kind: "cowork",
      entryTier: "open-space",
      coffee: input.coffee ?? false,
      date,
    };
  }

  if (input.entryTier === "reserved-desk") {
    return {
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      date,
      ...(input.monitorOption && { monitorOption: input.monitorOption }),
    };
  }

  if (input.entryTier === "plus") {
    return { kind: "cowork", entryTier: "plus", coffee: true, date };
  }

  if (input.entryTier === "profi") {
    return {
      kind: "cowork",
      entryTier: "profi",
      coffee: true,
      date,
      monitorOption: input.monitorOption,
    };
  }

  return {
    kind: "cowork",
    entryTier: "basic",
    coffee: input.coffee ?? false,
    date,
  };
};

const makeMeetingRoomReservation = (
  overrides: {
    readonly startsAt?: string;
    readonly endsAt?: string;
    readonly earlySetup?: boolean;
  } = {}
): WorkspaceTableAssignmentReservation => ({
  kind: "meeting-room",
  duration: { unit: "hour", amount: 1 },
  reservationDate: "2099-06-10",
  startsAt: "2099-06-10T07:00:00Z",
  endsAt: "2099-06-10T08:00:00Z",
  ...overrides,
});

const makeOfficeReservation = (
  overrides: {
    readonly startsOn?: string;
    readonly endsOn?: string;
    readonly seats?: number;
  } = {}
): WorkspaceTableAssignmentReservation => ({
  kind: "office",
  startsOn: "2099-06-10",
  endsOn: "2099-06-10",
  seats: 2,
  ...overrides,
});

const makeTable = (input: {
  readonly id?: string;
  readonly name: string;
  readonly tags?: string[];
  readonly seats?: string;
  readonly positionX?: string;
  readonly positionY?: string;
  readonly locationName?: string;
  readonly display?: boolean;
  readonly enabled?: boolean;
}): Table => ({
  _cloudId: "cloud",
  display: true,
  enabled: true,
  seats: "1",
  ...input,
});

const makeDotyposReservation = (input: {
  readonly id?: string;
  readonly tableId: string;
  readonly status: Reservation["status"];
  readonly seats?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}): Reservation => ({
  _branchId: "branch",
  _cloudId: "cloud",
  id: input.id,
  _tableId: input.tableId,
  startDate: input.startDate ?? "2099-06-09T22:00:00Z",
  endDate: input.endDate ?? "2099-06-10T22:00:00Z",
  seats: input.seats ?? "1",
  status: input.status,
});

const makeAssignmentLayer = (
  tables: readonly Table[],
  dotyposReservations: readonly Reservation[],
  expiredHoldDotyposReservationIds: readonly string[],
  onReservationInterval?: (interval: DotyposReservationInterval) => void
) => {
  const dotyposService: DotyposAssignmentTestService = {
    createReservation: mock(() => Effect.die("createReservation not mocked")),
    getReservation: mock(() => Effect.die("getReservation not mocked")),
    getCustomer: mock(() => Effect.die("getCustomer not mocked")),
    findCustomer: mock(() => Effect.die("findCustomer not mocked")),
    findOrCreateCustomer: mock(() =>
      Effect.die("findOrCreateCustomer not mocked")
    ),
    getTables: mock(() => Effect.succeed([...tables])),
    listActiveReservationsOverlapping: mock((interval) => {
      onReservationInterval?.(interval);
      return Effect.succeed([...dotyposReservations]);
    }),
    listReservations: mock(() => Effect.succeed([...dotyposReservations])),
    getProducts: mock(() => Effect.die("getProducts not mocked")),
    getCategories: mock(() => Effect.die("getCategories not mocked")),
  };

  return WorkspaceTableAssignmentService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DotyposService, dotyposService),
        Layer.succeed(WorkspaceReservationRepository, {
          selectExpiredHoldDotyposReservationIds: mock(() =>
            Effect.succeed([...expiredHoldDotyposReservationIds])
          ),
        } as never)
      )
    )
  );
};

const assignTableId = (
  reservation: WorkspaceTableAssignmentReservation,
  tables: readonly Table[],
  dotyposReservations: readonly Reservation[] = [],
  expiredHoldDotyposReservationIds: readonly string[] = [],
  onReservationInterval?: (interval: DotyposReservationInterval) => void
) =>
  Effect.gen(function* () {
    const service = yield* WorkspaceTableAssignmentService;
    return yield* service.assignTableId(reservation);
  }).pipe(
    Effect.provide(
      makeAssignmentLayer(
        tables,
        dotyposReservations,
        expiredHoldDotyposReservationIds,
        onReservationInterval
      )
    ),
    Effect.runPromise
  );

const getAssignedTableAvailability = (
  input: {
    readonly reservation: Reservation;
    readonly kind: WorkspaceReservationKind;
  },
  tables: readonly Table[],
  dotyposReservations: readonly Reservation[] = [],
  expiredHoldDotyposReservationIds: readonly string[] = [],
  onReservationInterval?: (interval: DotyposReservationInterval) => void
) =>
  Effect.gen(function* () {
    const service = yield* WorkspaceTableAssignmentService;
    return yield* service.getAssignedTableAvailability(input);
  }).pipe(
    Effect.provide(
      makeAssignmentLayer(
        tables,
        dotyposReservations,
        expiredHoldDotyposReservationIds,
        onReservationInterval
      )
    ),
    Effect.runPromise
  );

describe("WorkspaceTableAssignmentService", () => {
  test("loads only reservations overlapping the exact meeting-room interval", async () => {
    let interval: DotyposReservationInterval | undefined;

    await assignTableId(
      makeMeetingRoomReservation({
        startsAt: "2099-06-10T07:00:00Z",
        endsAt: "2099-06-10T11:00:00Z",
      }),
      [
        makeTable({
          id: "meeting-room",
          name: "Meeting room",
          tags: ["reservation:meeting-room"],
        }),
      ],
      [],
      [],
      (value) => {
        interval = value;
      }
    );

    expect(interval?.startDate.toISOString()).toBe("2099-06-10T07:00:00.000Z");
    expect(interval?.endDate.toISOString()).toBe("2099-06-10T11:00:00.000Z");
  });

  test("loads occupancy for an overnight Reserved Desk's noon-to-noon interval", async () => {
    let interval: DotyposReservationInterval | undefined;

    await assignTableId(
      {
        kind: "cowork",
        entryTier: "reserved-desk",
        coffee: true,
        date: "2099-06-10",
        stay: "overnight",
      },
      [
        makeTable({
          id: "desk-1",
          name: "Desk 1",
          tags: ["cowork:reserved-desk"],
        }),
      ],
      [],
      [],
      (value) => {
        interval = value;
      }
    );

    expect(interval?.startDate.toISOString()).toBe("2099-06-10T10:00:00.000Z");
    expect(interval?.endDate.toISOString()).toBe("2099-06-11T10:00:00.000Z");
  });

  test("uses the tier reservation interval as cowork occupancy input across DST", async () => {
    const captureInterval = () => {
      let interval: DotyposReservationInterval | undefined;
      return {
        get interval() {
          return interval;
        },
        capture: (value: DotyposReservationInterval) => {
          interval = value;
        },
      };
    };
    const openSpace = captureInterval();

    await assignTableId(
      makeReservation({ entryTier: "open-space", date: "2026-10-25" }),
      [
        makeTable({
          id: "open-1",
          name: "Open 1",
          tags: ["cowork:open-space"],
        }),
      ],
      [],
      [],
      openSpace.capture
    );

    expect(openSpace.interval?.startDate.toISOString()).toBe(
      "2026-10-24T22:00:00.000Z"
    );
    expect(openSpace.interval?.endDate.toISOString()).toBe(
      "2026-10-25T16:00:00.000Z"
    );

    const reservedDesk = captureInterval();

    await assignTableId(
      makeReservation({ entryTier: "reserved-desk", date: "2026-10-25" }),
      [
        makeTable({
          id: "desk-1",
          name: "Desk 1",
          tags: ["cowork:reserved-desk"],
        }),
      ],
      [],
      [],
      reservedDesk.capture
    );

    expect(reservedDesk.interval?.startDate.toISOString()).toBe(
      "2026-10-24T22:00:00.000Z"
    );
    expect(reservedDesk.interval?.endDate.toISOString()).toBe(
      "2026-10-25T23:00:00.000Z"
    );
  });

  test("reports a full table as unavailable capacity rather than invalid input", async () => {
    // Late-payment recovery refunds on this outcome, so it must stay
    // distinguishable from provider validation failures that are retried.
    await expect(
      assignTableId(
        makeReservation({ entryTier: "open-space" }),
        [
          makeTable({
            id: "open-1",
            name: "Open 1",
            tags: ["cowork:open-space"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-1",
            status: "CONFIRMED",
            startDate: "2099-06-10T06:00:00Z",
            endDate: "2099-06-10T08:00:00Z",
          }),
        ]
      )
    ).rejects.toMatchObject({
      _tag: "TableAssignmentUnavailableError",
      requiredTags: ["cowork:open-space"],
    });
  });

  test("keeps the 17:00 half-open boundary parity on the assignment path", async () => {
    // A reservation starting exactly at 17:00 Prague does not occupy the
    // 00:00-17:00 exclusive-end open-space interval.
    await expect(
      assignTableId(
        makeReservation({ entryTier: "open-space" }),
        [
          makeTable({
            id: "open-1",
            name: "Open 1",
            tags: ["cowork:open-space"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-1",
            status: "NEW",
            startDate: "2099-06-10T15:00:00Z",
            endDate: "2099-06-10T18:00:00Z",
          }),
        ]
      )
    ).resolves.toBe("open-1");

    // A reservation ending exactly at 17:00 Prague still occupies the
    // 00:00-17:00 interval up to its exclusive end.
    await expect(
      assignTableId(
        makeReservation({ entryTier: "open-space" }),
        [
          makeTable({
            id: "open-1",
            name: "Open 1",
            tags: ["cowork:open-space"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-1",
            status: "NEW",
            startDate: "2099-06-10T14:00:00Z",
            endDate: "2099-06-10T15:00:00Z",
          }),
        ]
      )
    ).rejects.toThrow(
      "No available Dotypos workspace table matches tags: cowork:open-space"
    );
  });

  test("blocks a reserved-desk assignment for an after-17:00 occupancy", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "reserved-desk" }),
        [
          makeTable({
            id: "desk-1",
            name: "Desk 1",
            tags: ["cowork:reserved-desk"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "desk-1",
            status: "CONFIRMED",
            startDate: "2099-06-10T16:00:00Z",
            endDate: "2099-06-10T18:00:00Z",
          }),
        ]
      )
    ).rejects.toThrow(
      "No available Dotypos workspace table matches tags: cowork:reserved-desk"
    );
  });

  test("matches Profi 2x27 QHD by tier and monitor tags", async () => {
    await expect(
      assignTableId(
        makeReservation({
          entryTier: "profi",
          monitorOption: "2x27-qhd",
        }),
        [
          makeTable({
            id: "wrong-resolution",
            name: "3",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:27",
              "monitor:resolution:4k",
            ],
          }),
          makeTable({
            id: "qhd-27",
            name: "1",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:27",
              "monitor:resolution:qhd",
            ],
          }),
        ]
      )
    ).resolves.toBe("qhd-27");
  });

  test("skips an occupied matching table and assigns the next free matching table", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "basic", date: "2099-06-10" }),
        [
          makeTable({ id: "basic-1", name: "1", tags: ["tier:basic"] }),
          makeTable({ id: "basic-2", name: "2", tags: ["tier:basic"] }),
        ],
        [makeDotyposReservation({ tableId: "basic-1", status: "NEW" })]
      )
    ).resolves.toBe("basic-2");
  });

  test("does not count back-to-back meeting-room reservations as occupied", async () => {
    await expect(
      assignTableId(
        makeMeetingRoomReservation({
          startsAt: "2099-06-10T12:00:00Z",
          endsAt: "2099-06-10T13:00:00Z",
        }),
        [
          makeTable({
            id: "room-1",
            name: "Room 1",
            tags: ["reservation:meeting-room"],
            seats: "12",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "room-1",
            status: "NEW",
            startDate: "2099-06-10T06:00:00Z",
            endDate: "2099-06-10T12:00:00Z",
          }),
        ]
      )
    ).resolves.toBe("room-1");
  });

  test("includes early setup in the half-open meeting-room occupancy interval", async () => {
    const table = [
      makeTable({
        id: "room-1",
        name: "Room 1",
        tags: ["reservation:meeting-room"],
      }),
    ];
    const booking = makeMeetingRoomReservation({
      startsAt: "2099-06-10T08:00:00Z",
      endsAt: "2099-06-10T09:00:00Z",
    });
    const precedingReservation = makeDotyposReservation({
      tableId: "room-1",
      status: "NEW",
      startDate: "2099-06-10T07:00:00Z",
      endDate: "2099-06-10T08:00:00Z",
    });

    await expect(
      assignTableId(booking, table, [precedingReservation])
    ).resolves.toBe("room-1");
    await expect(
      assignTableId({ ...booking, earlySetup: true }, table, [
        precedingReservation,
      ])
    ).rejects.toBeInstanceOf(TableAssignmentUnavailableError);
    await expect(
      assignTableId({ ...booking, earlySetup: true }, table, [
        {
          ...precedingReservation,
          endDate: "2099-06-10T07:45:00Z",
        },
      ])
    ).resolves.toBe("room-1");
  });

  test("reserves overlapping meeting-room tables exclusively", async () => {
    await expect(
      assignTableId(
        makeMeetingRoomReservation(),
        [
          makeTable({
            id: "room-1",
            name: "Room 1",
            tags: ["reservation:meeting-room"],
            seats: "12",
          }),
          makeTable({
            id: "room-2",
            name: "Room 2",
            tags: ["reservation:meeting-room"],
            seats: "12",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "room-1",
            status: "NEW",
            seats: "1",
            startDate: "2099-06-10T07:30:00Z",
            endDate: "2099-06-10T08:30:00Z",
          }),
        ]
      )
    ).resolves.toBe("room-2");
  });

  test("rejects a partially occupied office despite sufficient remaining capacity", async () => {
    await expect(
      assignTableId(
        makeOfficeReservation(),
        [
          makeTable({
            id: "office",
            name: "Office",
            tags: ["reservation:office"],
            seats: "8",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "office",
            status: "CONFIRMED",
            seats: "1",
          }),
        ]
      )
    ).rejects.toThrow(
      "No available Dotypos workspace table matches tags: reservation:office"
    );
  });

  test("ignores expired local holds while assigning a table", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "basic", date: "2099-06-10" }),
        [
          makeTable({ id: "basic-1", name: "1", tags: ["tier:basic"] }),
          makeTable({ id: "basic-2", name: "2", tags: ["tier:basic"] }),
        ],
        [
          makeDotyposReservation({
            id: "expired-dotypos-reservation-id",
            tableId: "basic-1",
            status: "NEW",
          }),
        ],
        ["expired-dotypos-reservation-id"]
      )
    ).resolves.toBe("basic-1");
  });

  test("assigns a matching table when existing reservations leave enough capacity", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "basic", date: "2099-06-10" }),
        [
          makeTable({
            id: "basic-1",
            name: "1",
            tags: ["tier:basic"],
            seats: "2",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "basic-1",
            status: "NEW",
            seats: "1",
          }),
        ]
      )
    ).resolves.toBe("basic-1");
  });

  test("ranks Reserved Desk away from an otherwise empty Open Space table", async () => {
    await expect(
      assignTableId(makeReservation({ entryTier: "reserved-desk" }), [
        makeTable({
          id: "open-space",
          name: "1 Open Space",
          tags: ["cowork:open-space"],
          seats: "4",
          positionX: "0",
          positionY: "0",
          locationName: "main",
        }),
        makeTable({
          id: "reserved-near",
          name: "2 Reserved Near",
          tags: ["cowork:reserved-desk"],
          seats: "2",
          positionX: "1",
          positionY: "0",
          locationName: "main",
        }),
        makeTable({
          id: "reserved-far",
          name: "3 Reserved Far",
          tags: ["cowork:reserved-desk"],
          seats: "2",
          positionX: "10",
          positionY: "0",
          locationName: "main",
        }),
      ])
    ).resolves.toBe("reserved-far");
  });

  test("weights Open Space ranking by max(actual occupancy, seat capacity)", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "reserved-desk" }),
        [
          makeTable({
            id: "open-high-capacity",
            name: "1 Open High Capacity",
            tags: ["cowork:open-space"],
            seats: "4",
            positionX: "0",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "open-low-capacity",
            name: "2 Open Low Capacity",
            tags: ["cowork:open-space"],
            seats: "1",
            positionX: "10",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "reserved-near-high-capacity",
            name: "3 Reserved Near High Capacity",
            tags: ["cowork:reserved-desk"],
            seats: "2",
            positionX: "2.4",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "reserved-near-low-capacity",
            name: "4 Reserved Near Low Capacity",
            tags: ["cowork:reserved-desk"],
            seats: "2",
            positionX: "2.0",
            positionY: "0",
            locationName: "main",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-high-capacity",
            status: "CONFIRMED",
            seats: "3",
          }),
        ]
      )
    ).resolves.toBe("reserved-near-high-capacity");
  });

  test("preserves actual Open Space occupancy above its configured capacity for ranking", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "reserved-desk" }),
        [
          makeTable({
            id: "open-high-capacity",
            name: "1 Open High Capacity",
            tags: ["cowork:open-space"],
            seats: "4",
            positionX: "0",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "open-low-capacity",
            name: "2 Open Low Capacity",
            tags: ["cowork:open-space"],
            seats: "1",
            positionX: "10",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "reserved-near-high-capacity",
            name: "3 Reserved Near High Capacity",
            tags: ["cowork:reserved-desk"],
            seats: "2",
            positionX: "1.7",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "reserved-near-low-capacity",
            name: "4 Reserved Near Low Capacity",
            tags: ["cowork:reserved-desk"],
            seats: "2",
            positionX: "1.3",
            positionY: "0",
            locationName: "main",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-high-capacity",
            status: "CONFIRMED",
            seats: "6",
          }),
        ]
      )
    ).resolves.toBe("reserved-near-high-capacity");
  });

  test("keeps a dual-tag Reserved Desk assignable using actual remaining capacity", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "reserved-desk" }),
        [
          makeTable({
            id: "dual-tag",
            name: "Dual-tag table",
            tags: ["cowork:open-space", "cowork:reserved-desk"],
            seats: "2",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "dual-tag",
            status: "CONFIRMED",
            seats: "1",
          }),
        ]
      )
    ).resolves.toBe("dual-tag");
  });

  test("ignores hidden, disabled, inactive-flag, and unlabeled active visible virtual tables", async () => {
    await expect(
      assignTableId(makeReservation({ entryTier: "basic" }), [
        makeTable({ id: "online", name: "Online reservation", tags: [] }),
        {
          _cloudId: "cloud",
          id: "missing-display-enabled",
          name: "0",
          tags: ["tier:basic"],
        } satisfies Table,
        makeTable({
          id: "hidden",
          name: "1",
          tags: ["tier:basic"],
          display: false,
        }),
        makeTable({
          id: "disabled",
          name: "2",
          tags: ["tier:basic"],
          enabled: false,
        }),
        makeTable({ id: "basic-8", name: "8", tags: ["tier:basic"] }),
      ])
    ).resolves.toBe("basic-8");
  });

  test("fails clearly when no active visible table matches all required tags", async () => {
    await expect(
      assignTableId(
        makeReservation({
          entryTier: "profi",
          monitorOption: "2x27-qhd",
        }),
        [
          makeTable({ id: "profi-only", name: "1", tags: ["tier:profi"] }),
          makeTable({
            id: "qhd-only",
            name: "2",
            tags: ["monitor:resolution:qhd"],
          }),
        ]
      )
    ).rejects.toMatchObject({ _tag: "TableAssignmentUnconfigured" });
  });
});

describe("WorkspaceTableAssignmentService.getAssignedTableAvailability", () => {
  const meetingRoom = makeTable({
    id: "room-1",
    name: "Room 1",
    tags: ["reservation:meeting-room"],
    seats: "12",
  });
  const office = makeTable({
    id: "office",
    name: "Office",
    tags: ["reservation:office"],
    seats: "8",
  });
  const openSpace = makeTable({
    id: "open-space-1",
    name: "Open Space 1",
    tags: ["cowork:open-space"],
    seats: "2",
  });
  // A cancelled 08:00–09:00 UTC booking of room-1.
  const restoredMeetingRoom = makeDotyposReservation({
    id: "restored-booking",
    tableId: "room-1",
    status: "CANCELLED",
    startDate: "2099-06-10T08:00:00Z",
    endDate: "2099-06-10T09:00:00Z",
  });

  test("reports a free assigned table as available and queries the held span", async () => {
    const intervals: DotyposReservationInterval[] = [];

    await expect(
      getAssignedTableAvailability(
        { reservation: restoredMeetingRoom, kind: "meeting-room" },
        [meetingRoom],
        [],
        [],
        (interval) => intervals.push(interval)
      )
    ).resolves.toBe("available");
    expect(intervals).toEqual([
      {
        startDate: new Date("2099-06-10T08:00:00Z"),
        endDate: new Date("2099-06-10T09:00:00Z"),
      },
    ]);
  });

  test.each(["NEW", "CONFIRMED"] as const)(
    "reports a table an overlapping %s booking holds as unavailable",
    async (status) => {
      await expect(
        getAssignedTableAvailability(
          { reservation: restoredMeetingRoom, kind: "meeting-room" },
          [meetingRoom],
          [
            makeDotyposReservation({
              id: "other-booking",
              tableId: "room-1",
              status,
              startDate: "2099-06-10T08:30:00Z",
              endDate: "2099-06-10T09:30:00Z",
            }),
          ]
        )
      ).resolves.toBe("unavailable");
    }
  );

  test("ignores cancelled bookings, other tables, and expired local holds", async () => {
    await expect(
      getAssignedTableAvailability(
        { reservation: restoredMeetingRoom, kind: "meeting-room" },
        [meetingRoom],
        [
          makeDotyposReservation({
            id: "cancelled-booking",
            tableId: "room-1",
            status: "CANCELLED",
            startDate: "2099-06-10T08:00:00Z",
            endDate: "2099-06-10T09:00:00Z",
          }),
          makeDotyposReservation({
            id: "other-room-booking",
            tableId: "room-2",
            status: "CONFIRMED",
            startDate: "2099-06-10T08:00:00Z",
            endDate: "2099-06-10T09:00:00Z",
          }),
          makeDotyposReservation({
            id: "expired-hold",
            tableId: "room-1",
            status: "NEW",
            startDate: "2099-06-10T08:00:00Z",
            endDate: "2099-06-10T09:00:00Z",
          }),
        ],
        ["expired-hold"]
      )
    ).resolves.toBe("available");
  });

  test("keeps the occupancy interval half-open at both bounds", async () => {
    await expect(
      getAssignedTableAvailability(
        { reservation: restoredMeetingRoom, kind: "meeting-room" },
        [meetingRoom],
        [
          makeDotyposReservation({
            id: "before",
            tableId: "room-1",
            status: "CONFIRMED",
            startDate: "2099-06-10T07:00:00Z",
            endDate: "2099-06-10T08:00:00Z",
          }),
          makeDotyposReservation({
            id: "after",
            tableId: "room-1",
            status: "NEW",
            startDate: "2099-06-10T09:00:00Z",
            endDate: "2099-06-10T10:00:00Z",
          }),
        ]
      )
    ).resolves.toBe("available");
  });

  test("checks the early-setup span Dotypos holds for a meeting room", async () => {
    // Booked 08:00–09:00 with early setup: Dotypos holds it from 07:45.
    const earlySetupBooking = {
      ...restoredMeetingRoom,
      startDate: "2099-06-10T07:45:00Z",
    };
    const preceding = makeDotyposReservation({
      id: "preceding",
      tableId: "room-1",
      status: "CONFIRMED",
      startDate: "2099-06-10T07:00:00Z",
      endDate: "2099-06-10T07:50:00Z",
    });

    await expect(
      getAssignedTableAvailability(
        { reservation: earlySetupBooking, kind: "meeting-room" },
        [meetingRoom],
        [preceding]
      )
    ).resolves.toBe("unavailable");
    await expect(
      getAssignedTableAvailability(
        { reservation: earlySetupBooking, kind: "meeting-room" },
        [meetingRoom],
        [{ ...preceding, endDate: "2099-06-10T07:45:00Z" }]
      )
    ).resolves.toBe("available");
  });

  test("never counts the restored booking itself, even once Dotypos confirmed it", async () => {
    await expect(
      getAssignedTableAvailability(
        { reservation: restoredMeetingRoom, kind: "meeting-room" },
        [meetingRoom],
        [{ ...restoredMeetingRoom, status: "CONFIRMED" }]
      )
    ).resolves.toBe("available");
  });

  test("requires an office to be otherwise empty and to fit its seats", async () => {
    const restoredOffice = makeDotyposReservation({
      id: "restored-office",
      tableId: "office",
      status: "CANCELLED",
      seats: "3",
    });

    await expect(
      getAssignedTableAvailability(
        { reservation: restoredOffice, kind: "office" },
        [office],
        [
          makeDotyposReservation({
            id: "office-seat",
            tableId: "office",
            status: "CONFIRMED",
            seats: "1",
          }),
        ]
      )
    ).resolves.toBe("unavailable");
    await expect(
      getAssignedTableAvailability(
        { reservation: { ...restoredOffice, seats: "9" }, kind: "office" },
        [office]
      )
    ).resolves.toBe("unavailable");
    await expect(
      getAssignedTableAvailability(
        { reservation: restoredOffice, kind: "office" },
        [office]
      )
    ).resolves.toBe("available");
  });

  test("lets cowork share its table up to the table's seat capacity", async () => {
    const restoredCowork = makeDotyposReservation({
      id: "restored-cowork",
      tableId: "open-space-1",
      status: "CANCELLED",
    });
    const sharing = makeDotyposReservation({
      id: "sharing",
      tableId: "open-space-1",
      status: "CONFIRMED",
    });

    await expect(
      getAssignedTableAvailability(
        { reservation: restoredCowork, kind: "cowork" },
        [openSpace],
        [sharing]
      )
    ).resolves.toBe("available");
    await expect(
      getAssignedTableAvailability(
        { reservation: restoredCowork, kind: "cowork" },
        [openSpace],
        [sharing, { ...sharing, id: "sharing-2" }]
      )
    ).resolves.toBe("unavailable");
  });

  test.each([
    { name: "missing", tables: [] },
    { name: "disabled", tables: [{ ...meetingRoom, enabled: false }] },
    { name: "hidden", tables: [{ ...meetingRoom, display: false }] },
  ])("reports a $name assigned table as unavailable", async ({ tables }) => {
    await expect(
      getAssignedTableAvailability(
        { reservation: restoredMeetingRoom, kind: "meeting-room" },
        tables
      )
    ).resolves.toBe("unavailable");
  });

  test("reports a booking without a table, an increasing span, or readable seats as unavailable", async () => {
    for (const reservation of [
      { ...restoredMeetingRoom, startDate: restoredMeetingRoom.endDate },
      { ...restoredMeetingRoom, seats: "many" },
    ]) {
      await expect(
        getAssignedTableAvailability({ reservation, kind: "meeting-room" }, [
          meetingRoom,
        ])
      ).resolves.toBe("unavailable");
    }

    await expect(
      getAssignedTableAvailability(
        {
          reservation: { ...restoredMeetingRoom, _tableId: undefined },
          kind: "meeting-room",
        },
        [meetingRoom]
      )
    ).resolves.toBe("unavailable");
    await expect(
      getAssignedTableAvailability(
        {
          reservation: { ...restoredMeetingRoom, endDate: "not-a-date" },
          kind: "meeting-room",
        },
        [meetingRoom]
      )
    ).resolves.toBe("unavailable");
  });

  test("fails on an assigned table with an unusable seat capacity", async () => {
    await expect(
      getAssignedTableAvailability(
        { reservation: restoredMeetingRoom, kind: "meeting-room" },
        [{ ...meetingRoom, seats: "zero" }]
      )
    ).rejects.toMatchObject({ _tag: "InvalidDotyposTableSeats" });
  });
});
