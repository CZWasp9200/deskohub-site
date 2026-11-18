CREATE TABLE "reservation_invitee_notices" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"invitee_id" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"restored_access" text,
	"settled_at" timestamp with time zone,
	CONSTRAINT "reservation_invitee_notices_event_unique" UNIQUE("invitee_id","kind","occurred_at"),
	CONSTRAINT "reservation_invitee_notices_access_check" CHECK ("restored_access" is null or (
      "kind" = 'restoration' and "restored_access" in ('past', 'link', 'issued')
    )),
	CONSTRAINT "reservation_invitee_notices_kind_check" CHECK ("kind" in ('invitation', 'cancellation', 'restoration'))
);
--> statement-breakpoint
ALTER TABLE "reservation_invitees" ADD COLUMN "retention_retry_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "reservation_invitee_notices_due_idx" ON "reservation_invitee_notices" ("next_attempt_at","id") WHERE "settled_at" is null;--> statement-breakpoint
ALTER TABLE "reservation_invitee_notices" ADD CONSTRAINT "reservation_invitee_notices_RJj9n7aiCG8t_fkey" FOREIGN KEY ("invitee_id") REFERENCES "reservation_invitees"("id") ON DELETE CASCADE;