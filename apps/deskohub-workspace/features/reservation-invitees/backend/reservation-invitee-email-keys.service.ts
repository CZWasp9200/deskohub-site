import { createHmac } from "node:crypto";
import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  type Option,
  Redacted,
} from "effect";
import type { InviteeEmail } from "@/features/office/office-people";
import {
  type ReservationInviteeKeyId,
  reservationInviteeKeyIdSchema,
} from "@/features/reservation-invitees/reservation-invitee";
import {
  deriveSealedStateSubkey,
  SealedStateKeys,
} from "@/shared/backend/sealed-state-keys.service";

/**
 * The keys of one sealed state ring entry for invitee addresses: the
 * pgcrypto passphrase that encrypts them and the secret of their lookup
 * digest. Both are HKDF subkeys of the entry, so they never coincide with its
 * Pay-state or checkout lookup use.
 */
interface ReservationInviteeEmailKey {
  readonly id: ReservationInviteeKeyId;
  readonly passphrase: Redacted.Redacted<string>;
  readonly lookupSecret: Redacted.Redacted<Buffer>;
}

/** An address's lookup digest under one key. */
interface ReservationInviteeEmailDigest {
  readonly keyId: ReservationInviteeKeyId;
  readonly digest: string;
}

export interface IReservationInviteeEmailKeys {
  /** Seals new addresses: the active ring entry's keys. */
  readonly active: ReservationInviteeEmailKey;
  /** The keys a row's `key_id` names, while that entry is configured. */
  readonly getById: (
    id: ReservationInviteeKeyId
  ) => Option.Option<ReservationInviteeEmailKey>;
  /** The digest a row sealed under `key` stores for `email`. */
  readonly digest: (
    key: ReservationInviteeEmailKey,
    email: InviteeEmail
  ) => ReservationInviteeEmailDigest;
  /**
   * `email`'s digest under every configured key, active first, so a lookup
   * finds rows sealed before a rotation.
   */
  readonly digests: (
    email: InviteeEmail
  ) => readonly [
    ReservationInviteeEmailDigest,
    ...ReservationInviteeEmailDigest[],
  ];
}

const passphraseInfo = "deskohub-workspace/reservation-invitee-email";
const lookupInfo = "deskohub-workspace/reservation-invitee-email-lookup";

const digest = (
  key: ReservationInviteeEmailKey,
  email: InviteeEmail
): ReservationInviteeEmailDigest => ({
  keyId: key.id,
  digest: createHmac("sha256", Redacted.value(key.lookupSecret))
    .update(email)
    .digest("hex"),
});

/**
 * The keys of invitee addresses, one set per `CHECKOUT_PAY_STATE_KEYS` entry
 * and named by its kid. Rotation follows the checkout key ring; an entry is
 * retired only once no `reservation_invitees` row is still sealed under it.
 */
export class ReservationInviteeEmailKeys extends Context.Service<
  ReservationInviteeEmailKeys,
  IReservationInviteeEmailKeys
>()("@deskohub-workspace/ReservationInviteeEmailKeys") {
  static Live = Layer.effect(
    ReservationInviteeEmailKeys,
    Effect.gen(function* () {
      const { ring } = yield* SealedStateKeys;
      const [active, ...rest] = Arr.map(
        ring,
        (entry): ReservationInviteeEmailKey => ({
          // A kid that isn't a valid key id is an invalid secret, as an
          // unparsable ring is.
          id: reservationInviteeKeyIdSchema.make(entry.kid),
          passphrase: Redacted.make(
            deriveSealedStateSubkey(entry, passphraseInfo).toString("hex")
          ),
          lookupSecret: Redacted.make(
            deriveSealedStateSubkey(entry, lookupInfo)
          ),
        })
      );
      const keys = [active, ...rest] as const;

      return ReservationInviteeEmailKeys.of({
        active,
        getById: (id) => Arr.findFirst(keys, (key) => key.id === id),
        digest,
        digests: (email) => Arr.map(keys, (key) => digest(key, email)),
      });
    })
  );

  static Default = ReservationInviteeEmailKeys.Live.pipe(
    Layer.provide(SealedStateKeys.Default)
  );
}
