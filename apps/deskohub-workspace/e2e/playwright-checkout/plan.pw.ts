import { expect } from "@playwright/test";
import { Effect } from "effect";
import { prepareDiscountAvailabilityE2E } from "../cases/discounts";
import { prepareMeetingRoomE2E } from "../cases/meeting-room";
import { prepareOfficeE2E } from "../cases/office";
import { getConfig, getDatasourceConfig } from "../config";
import { resolveE2EDotyposDiscountGroup } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { WorkspaceE2ECaseService } from "../services/cases";
import { E2ETelemetryService } from "../services/telemetry";
import { workspaceE2ECaseIds } from "./case-catalog";
import { writeWorkspaceE2ERunPlan } from "./run-plan";
import { runtimeTest as test } from "./runtime-fixtures";

// Preparation and plan construction share one test so the case phase is not
// delayed by an extra Playwright dependency barrier and worker start.
test("prepare availability and build the workspace checkout case plan", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  const run: Runner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: "",
  });
  const { actualCaseIds, preparation } = await runEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      const preparation = yield* Effect.all(
        {
          customerDiscountGroup: telemetry.tracePhase({
            effect: resolveE2EDotyposDiscountGroup(datasourceConfig),
            phaseId: "provider-preparation",
          }),
          discounts: telemetry.tracePhase({
            effect: prepareDiscountAvailabilityE2E(
              config,
              runContext.allocation
            ),
            phaseId: "cowork-availability-preparation",
          }),
          meetingRoom: telemetry.tracePhase({
            effect: prepareMeetingRoomE2E(config, runContext.allocation),
            phaseId: "meeting-room-availability-preparation",
          }),
          office: telemetry.tracePhase({
            effect: prepareOfficeE2E(config, runContext.allocation),
            phaseId: "office-availability-preparation",
          }),
        },
        { concurrency: "unbounded" }
      );
      const caseService = yield* WorkspaceE2ECaseService;
      const cases = yield* caseService.makeCases({
        allocation: runContext.allocation,
        config,
        datasourceConfig,
        flowStates: [],
        preparation,
        run,
      });
      return {
        actualCaseIds: cases.map(({ id }) => id).toSorted(),
        preparation,
      };
    })
  );

  const expectedCaseIds = workspaceE2ECaseIds.filter(
    (caseId) =>
      preparation.office !== undefined ||
      caseId !== "checkout-office-paid-multi-day"
  );
  expect(actualCaseIds).toEqual([...expectedCaseIds].toSorted());
  await writeWorkspaceE2ERunPlan({ preparation, runContext, version: 2 });
});
