import { eq, type SQL, sql } from "drizzle-orm";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import { isWithdrawnInFull } from "@/features/withdrawal/backend/withdrawn-contracts";

/**
 * Whether a customer's reservation is a paid booking that ends their
 * first-booking referral eligibility. A paid booking the customer withdrew
 * from in full, once cancelled, gives the eligibility back: the service never
 * started, so it was never their first visit.
 */
export const isPaidBooking: SQL = sql`(${eq(workspaceReservations.paymentState, "paid")} and not (${eq(workspaceReservations.reservationState, "cancelled")} and ${isWithdrawnInFull("reservation", workspaceReservations.id)}))`;
