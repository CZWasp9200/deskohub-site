SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "workspace_reservation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_reservation_order_match_check", ADD CONSTRAINT "payment_attempts_reservation_order_match_check" CHECK ("workspace_reservation_id" is null or "order_id" = "workspace_reservation_id");--> statement-breakpoint
-- The CHECK handles linked attempts. For an unlinked attempt, look at the
-- owning order's kind before allowing a missing reservation link.
CREATE OR REPLACE FUNCTION "link_payment_attempt_order"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	NEW."order_id" := COALESCE(NEW."order_id", NEW."workspace_reservation_id");
	IF NEW."workspace_reservation_id" IS NULL AND EXISTS (
		SELECT 1 FROM "orders" WHERE "id" = NEW."order_id" AND "kind" = 'reservation'
	) THEN
		RAISE check_violation
			USING CONSTRAINT = 'payment_attempts_reservation_order_match_check',
			      MESSAGE = 'A reservation order requires a matching reservation on its payment attempt.';
	END IF;
	RETURN NEW;
END
$function$;--> statement-breakpoint
DROP TRIGGER "payment_attempts_order_link" ON "payment_attempts";--> statement-breakpoint
CREATE TRIGGER "payment_attempts_order_link"
BEFORE INSERT OR UPDATE OF "order_id", "workspace_reservation_id"
ON "payment_attempts"
FOR EACH ROW
WHEN (NEW."order_id" IS NULL OR NEW."workspace_reservation_id" IS NULL)
EXECUTE FUNCTION "link_payment_attempt_order"();--> statement-breakpoint
SET LOCAL lock_timeout TO DEFAULT;
