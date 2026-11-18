import { testEmailAddress } from "@deskohub/test-email";
import type { OfficePeople } from "../selection/office-people";

/** `count` people on an office's list: You and invited addresses, or no one. */
export const officePeopleOf = (count: number): OfficePeople =>
  count === 0
    ? { contactAttends: false, invitees: [] }
    : {
        contactAttends: true,
        invitees: Array.from({ length: count - 1 }, (_, index) =>
          testEmailAddress(`person${index}`)
        ),
      };
