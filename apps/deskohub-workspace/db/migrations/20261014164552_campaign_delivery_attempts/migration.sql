ALTER TABLE "email_campaign_recipients" ADD COLUMN "delivery_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD COLUMN "delivery_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_attempt_idx" ON "email_campaign_recipients" ("send_id","delivery_attempt","dotypos_customer_id");--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_delivery_attempt_check" CHECK ("delivery_attempt" >= 1);