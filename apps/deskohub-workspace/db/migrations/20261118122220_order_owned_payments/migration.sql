SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- Payment attempts belong to an order. The insert trigger from
-- payment_order_mirror already links every attempt; the update covers any
-- attempt it missed before the column becomes required. The trigger stays, so
-- writers from before this migration keep inserting during a rolling deploy.
UPDATE "payment_attempts"
SET "order_id" = "workspace_reservation_id"
WHERE "order_id" IS NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
-- Legal evidence belongs to the order whose checkout accepted it.
ALTER TABLE "legal_evidence_events" ADD COLUMN "order_id" text;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "link_legal_evidence_order"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	NEW."order_id" := NEW."workspace_reservation_id";
	RETURN NEW;
END
$function$;--> statement-breakpoint
CREATE TRIGGER "legal_evidence_events_order_link"
BEFORE INSERT
ON "legal_evidence_events"
FOR EACH ROW
WHEN (NEW."order_id" IS NULL AND NEW."workspace_reservation_id" IS NOT NULL)
EXECUTE FUNCTION "link_legal_evidence_order"();--> statement-breakpoint
-- Set-based backfill: safe only while CREATE TRIGGER above holds SHARE ROW
-- EXCLUSIVE on legal_evidence_events. Every reservation has its mirrored
-- order with the same ID.
UPDATE "legal_evidence_events"
SET "order_id" = "workspace_reservation_id"
WHERE "order_id" IS NULL AND "workspace_reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "legal_evidence_events_order_idx" ON "legal_evidence_events" ("order_id");--> statement-breakpoint
ALTER TABLE "legal_evidence_events" ADD CONSTRAINT "legal_evidence_events_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "legal_evidence_events" ADD CONSTRAINT "legal_evidence_events_reservation_order_match_check" CHECK ("workspace_reservation_id" is null or "order_id" is null or "order_id" = "workspace_reservation_id");--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_kind_check", ADD CONSTRAINT "orders_kind_check" CHECK ("kind" in ('reservation', 'pass-purchase'));--> statement-breakpoint
SET LOCAL lock_timeout TO DEFAULT;
