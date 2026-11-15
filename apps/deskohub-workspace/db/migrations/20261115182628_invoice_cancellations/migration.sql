CREATE TABLE "corrective_document_number_counters" (
	"numbering_year" integer PRIMARY KEY,
	"last_sequence" integer NOT NULL,
	CONSTRAINT "corrective_document_number_counters_sequence_check" CHECK ("last_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "corrective_documents" (
	"cancelled_invoice_id" text PRIMARY KEY,
	"document_number" text NOT NULL,
	"numbering_year" integer NOT NULL,
	"numbering_sequence" integer NOT NULL,
	"key_id" text NOT NULL,
	"encrypted_document" bytea NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	CONSTRAINT "corrective_documents_numbering_sequence_check" CHECK ("numbering_sequence" > 0),
	CONSTRAINT "corrective_documents_key_id_check" CHECK ("key_id" ~ '^[A-Z][A-Z0-9_]{2,31}$'),
	CONSTRAINT "corrective_documents_issued_at_year_check" CHECK ("numbering_year" = extract(year from "issued_at" at time zone 'Europe/Prague')::integer)
);
--> statement-breakpoint
CREATE TABLE "invoice_archives" (
	"invoice_id" text PRIMARY KEY,
	"archived_at" timestamp with time zone NOT NULL,
	"actor_account_id" text,
	"actor_account_email" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "invoice_archives_email_check" CHECK (btrim("actor_account_email") <> ''),
	CONSTRAINT "invoice_archives_source_check" CHECK ("source" in ('admin-ui', 'dhw-cli', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "invoice_cancellation_notice_deliveries" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"invoice_id" text NOT NULL,
	"audience" text NOT NULL,
	"state" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"provider_delivery_id" text,
	"failure_code" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_cancellation_notice_deliveries_audience_check" CHECK ("audience" in ('customer', 'internal')),
	CONSTRAINT "invoice_cancellation_notice_deliveries_state_check" CHECK ("state" in ('processing', 'accepted', 'failed')),
	CONSTRAINT "invoice_cancellation_notice_deliveries_attempt_count_check" CHECK ("attempt_count" > 0),
	CONSTRAINT "invoice_cancellation_notice_deliveries_accepted_check" CHECK ("state" <> 'accepted' or ("provider_delivery_id" is not null and "accepted_at" is not null and "failure_code" is null)),
	CONSTRAINT "invoice_cancellation_notice_deliveries_failed_check" CHECK ("state" <> 'failed' or "failure_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "invoice_cancellations" (
	"invoice_id" text PRIMARY KEY,
	"cancelled_at" timestamp with time zone NOT NULL,
	"cause" text NOT NULL,
	"actor_account_id" text,
	"actor_account_email" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "invoice_cancellations_cause_check" CHECK ("cause" in ('invoice_cancellation', 'reservation_cancellation')),
	CONSTRAINT "invoice_cancellations_email_check" CHECK (btrim("actor_account_email") <> ''),
	CONSTRAINT "invoice_cancellations_source_check" CHECK ("source" in ('admin-ui', 'dhw-cli', 'assistant'))
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "replaces_invoice_id" text;--> statement-breakpoint
DROP INDEX "invoices_reservation_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_reservation_unique_idx" ON "invoices" ("workspace_reservation_id") WHERE "replaces_invoice_id" is null;--> statement-breakpoint
DROP INDEX "invoices_payment_attempt_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_payment_attempt_unique_idx" ON "invoices" ("payment_attempt_id") WHERE "replaces_invoice_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "corrective_documents_number_unique_idx" ON "corrective_documents" ("document_number");--> statement-breakpoint
CREATE UNIQUE INDEX "corrective_documents_year_sequence_unique_idx" ON "corrective_documents" ("numbering_year","numbering_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_cancellation_notice_deliveries_invoice_audience_unique_idx" ON "invoice_cancellation_notice_deliveries" ("invoice_id","audience");--> statement-breakpoint
CREATE INDEX "invoice_cancellation_notice_deliveries_state_updated_idx" ON "invoice_cancellation_notice_deliveries" ("state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_replaces_unique_idx" ON "invoices" ("replaces_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_id_reservation_unique_idx" ON "invoices" ("id","workspace_reservation_id");--> statement-breakpoint
ALTER TABLE "corrective_documents" ADD CONSTRAINT "corrective_documents_EBGDI029Woo2_fkey" FOREIGN KEY ("cancelled_invoice_id") REFERENCES "invoice_cancellations"("invoice_id");--> statement-breakpoint
ALTER TABLE "invoice_archives" ADD CONSTRAINT "invoice_archives_xRpmSUUfSvp4_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice_cancellations"("invoice_id");--> statement-breakpoint
ALTER TABLE "invoice_archives" ADD CONSTRAINT "invoice_archives_actor_account_id_user_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "invoice_cancellation_notice_deliveries" ADD CONSTRAINT "invoice_cancellation_notice_deliveries_oyQ16YFjaSum_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice_cancellations"("invoice_id");--> statement-breakpoint
ALTER TABLE "invoice_cancellations" ADD CONSTRAINT "invoice_cancellations_invoice_id_invoices_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id");--> statement-breakpoint
ALTER TABLE "invoice_cancellations" ADD CONSTRAINT "invoice_cancellations_actor_account_id_user_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_iYIa5Kfzed3R_fkey" FOREIGN KEY ("replaces_invoice_id") REFERENCES "invoice_cancellations"("invoice_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_replacement_reservation_fkey" FOREIGN KEY ("replaces_invoice_id","workspace_reservation_id") REFERENCES "invoices"("id","workspace_reservation_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_replacement_reservation_check" CHECK ("replaces_invoice_id" is null or "workspace_reservation_id" is not null);--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_corrective_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'issued corrective documents are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS corrective_documents_immutable ON "corrective_documents";
--> statement-breakpoint
CREATE TRIGGER corrective_documents_immutable
BEFORE UPDATE OR DELETE ON "corrective_documents"
FOR EACH ROW
EXECUTE FUNCTION reject_corrective_document_mutation();
