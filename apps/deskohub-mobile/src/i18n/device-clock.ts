import { getCalendars } from "expo-localization";

let hour12: boolean | undefined | null = null;

/**
 * Whether the device shows times on a 12-hour clock: `false` for a 24-hour
 * device, `undefined` when the device doesn't say (the locale decides).
 * Read once, at the first time the app formats.
 */
export const deviceHour12 = (): boolean | undefined => {
  if (hour12 === null) {
    const uses24 = getCalendars()[0]?.uses24hourClock;
    hour12 = typeof uses24 === "boolean" ? !uses24 : undefined;
  }
  return hour12;
};
