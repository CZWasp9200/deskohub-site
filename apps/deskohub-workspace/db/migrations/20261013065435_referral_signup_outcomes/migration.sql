ALTER TABLE "referral_signup_intents" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "referral_signup_intents" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referral_signup_intents" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referral_signup_intents" ADD CONSTRAINT "referral_signup_intents_outcome_check" CHECK (("outcome" is null) = ("settled_at" is null)
        and ("outcome" is null
          or "outcome" in ('applied', 'already-referred', 'not-eligible', 'code-unusable'))
        and ("acknowledged_at" is null or "settled_at" is not null));