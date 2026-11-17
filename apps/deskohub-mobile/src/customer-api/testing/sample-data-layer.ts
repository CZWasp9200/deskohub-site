import { Effect, Layer } from "effect";
import { AccountReadBudget } from "../account-read-budget";
import { accountDeviceLayer } from "../account-scoped-storage";
import {
  CustomerAccountScope,
  CustomerSessionCheck,
} from "../customer-api.service";
import type { CustomerDataServices } from "../customer-data-runtime";
import { deviceCapabilitiesLayer } from "../device-capabilities-layer";
import type { SampleAccountKind } from "../sample-data-mode";
import { fakeCustomerApiLayer } from "./fake-customer-data";
import {
  FakeWorkspace,
  fakeWorkspaceOrigin,
  sampleRequestOutcomes,
} from "./fake-workspace";
import {
  type SampleHistory,
  sampleHistoryOf,
  withSampleHistory,
} from "./sample-history";

// Every request the session makes, however many.
const everyRequest = 10_000;

/**
 * The development-only sample-data layer: the real clients over a fake
 * Workspace seeded with synthetic fixtures, with the device's real share
 * sheet, clipboard and picker. Loaded only behind the sample-data switch;
 * `EXPO_PUBLIC_ACCOUNT_SAMPLE_OUTCOMES` fails endpoints for captures
 * (`sampleRequestOutcomes`).
 */
export const sampleCustomerDataLayer = (
  kind: SampleAccountKind,
  history: SampleHistory = sampleHistoryOf(
    process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_HISTORY
  )
): Layer.Layer<CustomerDataServices> => {
  const workspace = withSampleHistory(FakeWorkspace.forKind(kind), history);
  for (const [endpoint, outcome] of sampleRequestOutcomes(
    process.env.EXPO_PUBLIC_ACCOUNT_SAMPLE_OUTCOMES
  ))
    workspace.fail(endpoint, outcome, everyRequest);
  return Layer.mergeAll(
    fakeCustomerApiLayer(workspace),
    AccountReadBudget.Default,
    Layer.succeed(CustomerSessionCheck, { recheck: Effect.void }),
    accountDeviceLayer(deviceCapabilitiesLayer).pipe(
      Layer.provideMerge(
        Layer.succeed(CustomerAccountScope, {
          accountId: workspace.data.accountId,
          apiOrigin: fakeWorkspaceOrigin,
          sessionStartedAt: 0,
        })
      )
    )
  );
};
