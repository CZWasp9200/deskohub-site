import { testEmailAddress } from "@deskohub/test-email";

export const workspaceE2EOfficeReservationDayCount = 2;
export const workspaceE2EOfficeReservationSeats = 2;

/**
 * The people an office checkout adds by email beside its contact: one
 * synthetic test address per seat after the contact's own.
 */
export const getWorkspaceE2EOfficeInvitees = (seats: number) =>
  Array.from({ length: Math.max(0, seats - 1) }, (_, index) =>
    testEmailAddress(`office-invitee-${index + 1}`)
  );
