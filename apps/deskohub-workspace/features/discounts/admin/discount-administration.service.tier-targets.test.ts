import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Effect, Layer } from "effect";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import {
  makeRecordingWorkspaceDatabase,
  type RecordingWorkspaceDatabase,
} from "@/shared/testing/workspace-recording-database.test-utils";
import type { StoredDiscountId } from "../persistence-contracts";
import type { CreateDiscountAdminInput } from "./contracts";
import { CoworkTierTargetReleaseGateMock } from "./cowork-tier-target-release-gate.service.mock";
import { DiscountAdministration } from "./discount-administration.service";

const discountId = "01980000-0000-7000-8000-000000000001" as StoredDiscountId;

const definition = (
  products: CreateDiscountAdminInput["products"]
): CreateDiscountAdminInput => ({
  labels: { "cs-CZ": "Stoly", "en-US": "Desks" },
  adjustment: { kind: "percentage", basisPoints: 1000 },
  products,
});

/** The gate is consulted only when a mutation adds a cowork tier target. */
const makeGate = (released: boolean) => {
  const evaluations = { count: 0 };
  const layer = CoworkTierTargetReleaseGateMock({
    isReleased: Effect.sync(() => {
      evaluations.count += 1;
      return released;
    }),
  });
  return { evaluations, layer };
};

const runAdministration = <A, E>(
  recording: RecordingWorkspaceDatabase,
  gate: ReturnType<typeof makeGate>,
  operation: (
    administration: DiscountAdministration["Service"]
  ) => Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    return yield* operation(yield* DiscountAdministration);
  }).pipe(
    Effect.provide(
      DiscountAdministration.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            recording.layer,
            Layer.mock(GoogleCalendarService, {}),
            Layer.mock(DotyposService, {}),
            Layer.mock(CalendarResourceConfig, {
              salesCalendarId: "sales-calendar" as never,
            }),
            gate.layer
          )
        )
      )
    ),
    Effect.result,
    Effect.runPromise
  );

const writesTargets = (recording: RecordingWorkspaceDatabase) =>
  recording.statements.some(({ sql }) =>
    /^(insert into|delete from) "discount_targets"/i.test(sql)
  );

const reservedDesk = {
  kind: "cowork",
  tier: "reserved-desk",
} satisfies WorkspaceProductTarget;

describe("DiscountAdministration cowork tier target release gate", () => {
  test("rejects a new discount with a tier target while unreleased", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const gate = makeGate(false);

    const result = await runAdministration(recording, gate, (administration) =>
      administration.createDiscount(definition([reservedDesk]))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "DiscountAdminUnreleasedTierTargetError" },
    });
    expect(recording.statements).toHaveLength(0);
  });

  test("creates a discount with a tier target once released", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([[[discountId]], []]);
    const gate = makeGate(true);

    const result = await runAdministration(recording, gate, (administration) =>
      administration.createDiscount(definition([reservedDesk]))
    );

    expect(result).toMatchObject({ _tag: "Success", success: discountId });
    expect(writesTargets(recording)).toBe(true);
  });

  test("creates whole-family discounts without consulting the gate", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([[[discountId]], []]);
    const gate = makeGate(false);

    const result = await runAdministration(recording, gate, (administration) =>
      administration.createDiscount(
        definition([{ kind: "cowork" }, { kind: "office" }])
      )
    );

    expect(result._tag).toBe("Success");
    expect(gate.evaluations.count).toBe(0);
  });

  test("rejects a new code discount with a tier target while unreleased", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const gate = makeGate(false);

    const result = await runAdministration(recording, gate, (administration) =>
      administration.createCode({
        code: {
          code: "DESKS10",
          enabled: true,
          validFrom: null,
          validUntil: null,
          maxUses: null,
        },
        discount: {
          kind: "new",
          discount: definition([{ kind: "cowork", tier: "open-space" }]),
        },
      } as never)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "DiscountAdminUnreleasedTierTargetError" },
    });
    expect(writesTargets(recording)).toBe(false);
  });

  test("keeps or removes stored tier targets while unreleased", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      [[discountId]],
      [[reservedDesk], [{ kind: "cowork", tier: "open-space" }]],
      [],
    ]);
    const gate = makeGate(false);

    const result = await runAdministration(recording, gate, (administration) =>
      administration.updateDiscount({
        id: discountId,
        ...definition([reservedDesk, { kind: "office" }]),
      })
    );

    expect(result._tag).toBe("Success");
    expect(writesTargets(recording)).toBe(true);
    expect(gate.evaluations.count).toBe(0);
  });

  test("rejects adding a tier target to a stored discount while unreleased", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([[[discountId]], [[reservedDesk]], []]);
    const gate = makeGate(false);

    const result = await runAdministration(recording, gate, (administration) =>
      administration.updateDiscount({
        id: discountId,
        ...definition([reservedDesk, { kind: "cowork", tier: "open-space" }]),
      })
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "DiscountAdminUnreleasedTierTargetError" },
    });
    expect(writesTargets(recording)).toBe(false);
  });

  test("adds a tier target to a stored discount once released", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([[[discountId]], [[{ kind: "cowork" }]], []]);
    const gate = makeGate(true);

    const result = await runAdministration(recording, gate, (administration) =>
      administration.updateDiscount({
        id: discountId,
        ...definition([reservedDesk]),
      })
    );

    expect(result._tag).toBe("Success");
    expect(writesTargets(recording)).toBe(true);
    expect(gate.evaluations.count).toBe(1);
  });
});
