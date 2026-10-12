CREATE TABLE "customer_locale_preferences" (
	"customer_account_id" text PRIMARY KEY,
	"locale" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_locale_preferences_locale_check" CHECK ("locale" in ('en-US', 'cs-CZ'))
);
--> statement-breakpoint
-- The locale pinned for the in-flight customer email idempotency generation:
-- written only while null before a generation's first provider send so failed
-- and accepted-but-unrecorded retries keep a locale-stable idempotency key,
-- and atomically cleared when the accepted send's delivery ID is recorded so
-- the next generation resolves the customer's current language preference.
-- Idempotent by IF NOT EXISTS; nullable, so no backfill is needed.
ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "active_customer_email_delivery_locale" text;--> statement-breakpoint
ALTER TABLE "customer_locale_preferences" ADD CONSTRAINT "customer_locale_preferences_customer_account_id_user_id_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;