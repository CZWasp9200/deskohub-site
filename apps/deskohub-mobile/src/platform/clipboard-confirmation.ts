/**
 * Whether the system confirms a copy on its own, so the app adds no toast:
 * Android 13 (API 33) and later shows a clipboard confirmation; iOS and the
 * web don't.
 */
export const systemConfirmsCopy = (platform: {
  readonly OS: string;
  readonly Version: string | number;
}): boolean => platform.OS === "android" && Number(platform.Version) >= 33;
