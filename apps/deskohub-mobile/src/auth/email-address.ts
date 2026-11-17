/** The longest address SMTP delivers (RFC 5321 path limit). */
const maxEmailAddressLength = 254;

const emailAddressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether a value has the shape of a deliverable email address. */
export const isEmailAddress = (value: string): boolean =>
  value.length <= maxEmailAddressLength && emailAddressPattern.test(value);
