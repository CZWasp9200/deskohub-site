ALTER TABLE "workspace_reservations" ADD COLUMN "cancellation_email_sent_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX "customer_events_workspace_write_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "customer_events_workspace_write_unique_idx" ON "customer_events" ("kind","workspace_reservation_id") WHERE "kind" = 'reservation-booked';--> statement-breakpoint
CREATE UNIQUE INDEX "customer_events_cancellation_unique_idx" ON "customer_events" ("kind","workspace_reservation_id","occurred_at") WHERE "kind" = 'reservation-cancelled';