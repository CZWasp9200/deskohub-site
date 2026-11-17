import { Context, Effect, Layer } from "effect";
import { ReservationWithdrawals } from "@/features/reservation/backend/reservation-withdrawals";
import type { WithdrawableContractFamily } from "../withdrawable-contract";
import type { WithdrawableContractKind } from "../withdrawal-identifiers";

/**
 * Every product family that offers withdrawal, by kind: the one place a new
 * family is registered. A family implements `WithdrawableContractFamily`
 * beside its own products and joins here and in `WithdrawableContractKind`.
 */
export class WithdrawableContractFamilies extends Context.Service<
  WithdrawableContractFamilies,
  {
    readonly get: (kind: WithdrawableContractKind) => WithdrawableContractFamily;
  }
>()("@deskohub-workspace/withdrawal/WithdrawableContractFamilies") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const families = {
        reservation: yield* ReservationWithdrawals,
      } satisfies Record<WithdrawableContractKind, WithdrawableContractFamily>;
      return { get: (kind) => families[kind] };
    })
  );
}
