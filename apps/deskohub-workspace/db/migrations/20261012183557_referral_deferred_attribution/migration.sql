CREATE TABLE "referral_signup_intents" (
	"customer_account_id" text PRIMARY KEY,
	"promotion_code_id" text NOT NULL,
	"referrer_dotypos_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_invitation_claims" DROP CONSTRAINT "referral_invitation_claims_DNDgiDyFCKlU_fkey";--> statement-breakpoint
ALTER TABLE "referral_invitation_claims" ADD COLUMN "referrer_dotypos_customer_id" text;--> statement-breakpoint
ALTER TABLE "referral_invitation_claims" ADD COLUMN "promotion_code_id" text;--> statement-breakpoint
ALTER TABLE "referral_invitation_claims" ADD CONSTRAINT "referral_invitation_claims_code_referrer_fk" FOREIGN KEY ("promotion_code_id","referrer_dotypos_customer_id") REFERENCES "referral_codes"("promotion_code_id","referrer_dotypos_customer_id");--> statement-breakpoint
ALTER TABLE "referral_signup_intents" ADD CONSTRAINT "referral_signup_intents_customer_account_id_user_id_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "referral_signup_intents" ADD CONSTRAINT "referral_signup_intents_code_referrer_fk" FOREIGN KEY ("promotion_code_id","referrer_dotypos_customer_id") REFERENCES "referral_codes"("promotion_code_id","referrer_dotypos_customer_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "referral_invitation_claims" ADD CONSTRAINT "referral_invitation_claims_referral_check" CHECK (("promotion_code_id" is null) = ("referrer_dotypos_customer_id" is null)
        and ("referrer_dotypos_customer_id" is null
          or "referrer_dotypos_customer_id" <> "invited_dotypos_customer_id"));