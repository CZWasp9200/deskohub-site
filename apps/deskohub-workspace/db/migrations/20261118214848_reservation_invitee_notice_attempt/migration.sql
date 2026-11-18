ALTER TABLE "reservation_invitee_notices" ADD COLUMN "request_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservation_invitee_notices" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "reservation_invitee_notices" ADD COLUMN "uncertainty" text;--> statement-breakpoint
ALTER TABLE "reservation_invitee_notices" ADD CONSTRAINT "reservation_invitee_notices_attempt_check" CHECK (("request_started_at" is null) = ("request_fingerprint" is null)
        and ("uncertainty" is null or (
          "settled_at" is not null and "request_started_at" is not null
          and "uncertainty" in ('request-changed', 'replay-expired', 'not-replayable', 'superseded')
        )));