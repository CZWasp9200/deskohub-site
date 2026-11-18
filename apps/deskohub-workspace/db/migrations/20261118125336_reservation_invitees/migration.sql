CREATE TABLE "reservation_invitees" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"workspace_reservation_id" text NOT NULL,
	"position" smallint NOT NULL,
	"key_id" text,
	"encrypted_email" bytea,
	"email_lookup_key" text,
	"customer_account_id" text,
	"dotypos_customer_id" text,
	"retain_until" timestamp with time zone NOT NULL,
	"last_invitation_sent_at" timestamp with time zone,
	"invitation_send_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_invitees_position_check" CHECK ("position" >= 0),
	CONSTRAINT "reservation_invitees_invitation_send_count_check" CHECK ("invitation_send_count" >= 0),
	CONSTRAINT "reservation_invitees_key_id_check" CHECK ("key_id" ~ '^[A-Za-z0-9_-]{1,32}$'),
	CONSTRAINT "reservation_invitees_address_check" CHECK ((
        "key_id" IS NOT NULL
        AND "encrypted_email" IS NOT NULL
        AND "email_lookup_key" IS NOT NULL
      ) OR (
        "key_id" IS NULL
        AND "encrypted_email" IS NULL
        AND "email_lookup_key" IS NULL
        AND (
          "customer_account_id" IS NOT NULL
          OR "dotypos_customer_id" IS NOT NULL
        )
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_invitees_reservation_position_idx" ON "reservation_invitees" ("workspace_reservation_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_invitees_reservation_lookup_idx" ON "reservation_invitees" ("workspace_reservation_id","email_lookup_key");--> statement-breakpoint
CREATE INDEX "reservation_invitees_email_lookup_idx" ON "reservation_invitees" ("email_lookup_key");--> statement-breakpoint
CREATE INDEX "reservation_invitees_customer_account_idx" ON "reservation_invitees" ("customer_account_id");--> statement-breakpoint
CREATE INDEX "reservation_invitees_dotypos_customer_idx" ON "reservation_invitees" ("dotypos_customer_id");--> statement-breakpoint
CREATE INDEX "reservation_invitees_retain_until_idx" ON "reservation_invitees" ("retain_until");--> statement-breakpoint
ALTER TABLE "reservation_invitees" ADD CONSTRAINT "reservation_invitees_gp08lmgljEAv_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reservation_invitees" ADD CONSTRAINT "reservation_invitees_QmZdQkL7I0C3_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id");