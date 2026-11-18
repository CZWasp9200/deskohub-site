CREATE TABLE "invoice_previews" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"invoice_id" text NOT NULL,
	"administrator_account_id" text NOT NULL,
	"key_id" text NOT NULL,
	"encrypted_document" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invoice_previews_expiry_check" CHECK ("expires_at" > "created_at"),
	CONSTRAINT "invoice_previews_key_id_check" CHECK ("key_id" ~ '^[A-Z][A-Z0-9_]{2,31}$')
);
--> statement-breakpoint
CREATE INDEX "invoice_previews_expires_at_idx" ON "invoice_previews" ("expires_at");--> statement-breakpoint
ALTER TABLE "invoice_previews" ADD CONSTRAINT "invoice_previews_administrator_account_id_user_id_fkey" FOREIGN KEY ("administrator_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;