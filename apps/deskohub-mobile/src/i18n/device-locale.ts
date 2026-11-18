import { getLocales } from "expo-localization";
import { useState } from "react";
import { type AppLocale, resolveAppLocale } from "./app-locale";
import { detectedCountry } from "./country-names";

/** The app locale for the device's language preferences. */
export const readDeviceLocale = (): AppLocale =>
  resolveAppLocale(getLocales().map(({ languageTag }) => languageTag));

/** The invoice country the device's language preferences point to. */
export const readDeviceCountry = (): string =>
  detectedCountry(getLocales().map(({ regionCode }) => regionCode));

/** The device's invoice country, read once while the calling component is mounted. */
export const useDeviceCountry = (): string => useState(readDeviceCountry)[0];
