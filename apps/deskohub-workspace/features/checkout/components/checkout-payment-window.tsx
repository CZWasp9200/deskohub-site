"use client";

import { useEffect, useRef } from "react";
import { coordinateReturnWindow } from "@/shared/browser/return-window";

const getCheckoutStatusLockName = () =>
  `deskohub:checkout-status:${window.location.pathname}`;
const getCheckoutStatusOwnerStorageKey = (pathname: string) =>
  `deskohub:checkout-status-owner:${pathname}`;
const consumeCheckoutStatusWindowOwner = (pathname: string) => {
  try {
    const storageKey = getCheckoutStatusOwnerStorageKey(pathname);
    const ownsStatusWindow = sessionStorage.getItem(storageKey) === "true";
    sessionStorage.removeItem(storageKey);
    return ownsStatusWindow;
  } catch {
    return false;
  }
};

const markCheckoutStatusWindowOwner = (statusUrl: string) => {
  try {
    const pathname = new URL(statusUrl, "https://deskohub.local").pathname;
    sessionStorage.setItem(getCheckoutStatusOwnerStorageKey(pathname), "true");
  } catch {
    // Ownership coordination must not block payment navigation.
  }
};

/**
 * Opens the payment gateway in a new tab. With `statusUrl`, this tab is about
 * to show that status page and claims its return there, so the returning tab
 * closes. A status page already showing holds the return through its
 * coordinator and passes none: a marker it can't consume would be copied
 * into every tab it opens later, which would then steal the return. Returns
 * false when the browser didn't open the tab.
 */
export const openCheckoutPaymentWindow = (
  redirectUrl: string,
  statusUrl?: string
) => {
  const paymentWindow = window.open(redirectUrl, "_blank");
  if (!paymentWindow) return false;

  paymentWindow.opener = null;
  if (statusUrl !== undefined) markCheckoutStatusWindowOwner(statusUrl);
  return true;
};

export function CheckoutPaymentWindowCoordinator() {
  const ownsStatusWindowRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    const ownsStatusWindow =
      ownsStatusWindowRef.current ??
      consumeCheckoutStatusWindowOwner(window.location.pathname);
    ownsStatusWindowRef.current = ownsStatusWindow;
    return coordinateReturnWindow({
      key: getCheckoutStatusLockName(),
      onDuplicate: () => window.close(),
      owner: ownsStatusWindow,
    });
  }, []);

  return null;
}
