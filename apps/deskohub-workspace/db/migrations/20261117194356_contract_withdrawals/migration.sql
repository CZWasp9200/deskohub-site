CREATE TABLE "contract_withdrawals" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"contract_kind" text NOT NULL,
	"contract_id" text NOT NULL,
	"customer_account_id" text NOT NULL,
	"locale" text NOT NULL,
	"contract_label" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"period_ends_at" timestamp with time zone NOT NULL,
	"paid_amount_value" integer NOT NULL,
	"refund_amount_value" integer NOT NULL,
	"amount_exponent" integer NOT NULL,
	"currency" text NOT NULL,
	"refund_unit" text,
	"refund_unstarted_units" integer,
	"refund_total_units" integer,
	"receipt_sent_at" timestamp with time zone,
	"operator_notified_at" timestamp with time zone,
	"contract_cancelled_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"settlement_claimed_at" timestamp with time zone,
	"receipt_attempts" integer DEFAULT 0 NOT NULL,
	"receipt_failure_code" text,
	"receipt_retry_at" timestamp with time zone,
	"operator_notice_attempts" integer DEFAULT 0 NOT NULL,
	"operator_notice_failure_code" text,
	"operator_notice_retry_at" timestamp with time zone,
	"cancellation_attempts" integer DEFAULT 0 NOT NULL,
	"cancellation_failure_code" text,
	"cancellation_retry_at" timestamp with time zone,
	"next_settlement_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_withdrawals_amount_check" CHECK ("paid_amount_value" >= 0 and "refund_amount_value" >= 0 and "refund_amount_value" <= "paid_amount_value" and "amount_exponent" >= 0 and "currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "contract_withdrawals_refund_basis_check" CHECK (("refund_unit" is null and "refund_unstarted_units" is null and "refund_total_units" is null and "refund_amount_value" = "paid_amount_value") or ("refund_unit" in ('day', 'hour') and "refund_unstarted_units" > 0 and "refund_total_units" > "refund_unstarted_units")),
	CONSTRAINT "contract_withdrawals_settled_check" CHECK ("settled_at" is null or ("receipt_sent_at" is not null and "operator_notified_at" is not null and "contract_cancelled_at" is not null)),
	CONSTRAINT "contract_withdrawals_contract_check" CHECK (btrim("contract_kind") <> '' and btrim("contract_id") <> '')
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "refund_target_value" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_withdrawals_contract_unique_idx" ON "contract_withdrawals" ("contract_kind","contract_id");--> statement-breakpoint
CREATE INDEX "contract_withdrawals_customer_account_idx" ON "contract_withdrawals" ("customer_account_id");--> statement-breakpoint
CREATE INDEX "contract_withdrawals_unsettled_idx" ON "contract_withdrawals" ("next_settlement_at") WHERE "settled_at" is null;--> statement-breakpoint
ALTER TABLE "contract_withdrawals" ADD CONSTRAINT "contract_withdrawals_r2BUs814ewrw_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_refund_target_check" CHECK ("refund_target_value" is null or ("refund_state" <> 'not_required' and "refund_target_value" > 0 and "refund_target_value" <= "amount_value"));--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" DROP CONSTRAINT "discount_code_redemptions_lifecycle_check", ADD CONSTRAINT "discount_code_redemptions_lifecycle_check" CHECK ((
        "state" = 'reserved'
        and "redeemed_at" is null
        and "released_at" is null
        and "release_reason" is null
      ) or (
        "state" = 'redeemed'
        and "redeemed_at" is not null
        and "released_at" is null
        and "release_reason" is null
      ) or (
        "state" = 'released'
        and "released_at" is not null
        and "release_reason" is not null
        and btrim("release_reason") <> ''
      ));--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_refund_record_check", ADD CONSTRAINT "payment_attempts_refund_record_check" CHECK (("refund_state" = 'refunded' and "refunded_amount_value" > 0 and "refunded_at" is not null) or ("refund_state" = 'required' and "refund_target_value" is not null and "refunded_amount_value" > 0 and "refunded_amount_value" < "refund_target_value" and "refunded_at" is not null) or ("refund_state" <> 'refunded' and "refunded_amount_value" is null and "refunded_at" is null));--> statement-breakpoint
ALTER TABLE "referral_invitation_claims" DROP CONSTRAINT "referral_invitation_claims_lifecycle_check", ADD CONSTRAINT "referral_invitation_claims_lifecycle_check" CHECK ((
        "state" = 'reserved'
        and "redeemed_at" is null
        and "released_at" is null
        and "release_reason" is null
      ) or (
        "state" = 'redeemed'
        and "redeemed_at" is not null
        and "released_at" is null
        and "release_reason" is null
      ) or (
        "state" = 'released'
        and "released_at" is not null
        and "release_reason" is not null
        and btrim("release_reason") <> ''
      ));--> statement-breakpoint
ALTER TABLE "voucher_redemptions" DROP CONSTRAINT "voucher_redemptions_lifecycle_check", ADD CONSTRAINT "voucher_redemptions_lifecycle_check" CHECK ((
        "state" = 'reserved'
        and "redeemed_at" is null
        and "released_at" is null
        and "release_reason" is null
      ) or (
        "state" = 'redeemed'
        and "redeemed_at" is not null
        and "released_at" is null
        and "release_reason" is null
      ) or (
        "state" = 'released'
        and "released_at" is not null
        and "release_reason" is not null
        and btrim("release_reason") <> ''
      ));