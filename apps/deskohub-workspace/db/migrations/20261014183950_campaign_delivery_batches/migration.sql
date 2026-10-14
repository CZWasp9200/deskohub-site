CREATE TABLE "email_campaign_delivery_batches" (
	"send_id" text,
	"delivery_attempt" integer,
	"batch_index" integer,
	"dotypos_customer_ids" text[] NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "email_campaign_delivery_batches_pkey" PRIMARY KEY("send_id","delivery_attempt","batch_index"),
	CONSTRAINT "email_campaign_delivery_batches_status_check" CHECK ("status" in ('requested', 'accepted', 'rejected', 'unconfirmed')),
	CONSTRAINT "email_campaign_delivery_batches_settled_check" CHECK (("status" = 'requested') = ("settled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "delivery_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD COLUMN "delivery_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_attempt_idx" ON "email_campaign_recipients" ("send_id","delivery_attempt","dotypos_customer_id");--> statement-breakpoint
ALTER TABLE "email_campaign_delivery_batches" ADD CONSTRAINT "email_campaign_delivery_batches_Cu1Bq88TyIQk_fkey" FOREIGN KEY ("send_id") REFERENCES "email_campaign_sends"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_skip_reason_check" CHECK (("status" = 'skipped') = ("skip_reason" is not null) and ("skip_reason" is null or "skip_reason" in ('missing-from-dotypos', 'deleted-customer', 'missing-email', 'invalid-email', 'consent-withdrawn', 'outside-test-domain')));--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_delivery_attempt_check" CHECK ("delivery_attempt" >= 1);--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" DROP CONSTRAINT "email_campaign_recipients_status_check", ADD CONSTRAINT "email_campaign_recipients_status_check" CHECK ("status" in ('pending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'unconfirmed', 'skipped'));