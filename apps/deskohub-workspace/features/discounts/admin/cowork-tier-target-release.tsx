"use client";

import { createContext, type ReactNode, useContext } from "react";

// Unreleased by default so an editor rendered without the server-evaluated
// gate cannot offer new single-tier cowork targets.
const CoworkTierTargetReleaseContext = createContext(false);

export function CoworkTierTargetReleaseProvider({
  children,
  released,
}: {
  readonly children: ReactNode;
  readonly released: boolean;
}) {
  return (
    <CoworkTierTargetReleaseContext value={released}>
      {children}
    </CoworkTierTargetReleaseContext>
  );
}

export const useCoworkTierTargetRelease = () =>
  useContext(CoworkTierTargetReleaseContext);
