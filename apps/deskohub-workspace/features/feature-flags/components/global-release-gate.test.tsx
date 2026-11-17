import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import type { GlobalRelease } from "@/features/feature-flags/backend/global-release";

const events: string[] = [];
let release: GlobalRelease = "undecided";
const loadGlobalRelease = mock(async (flag: string) => {
  events.push(`release:${flag}`);
  return release;
});
const connection = mock(async () => {
  events.push("connection");
});
const isEnabled = mock(async () => {
  events.push("flag");
  return false;
});

mock.module("next/server", () => ({ connection }));
mock.module("@/features/feature-flags/backend/global-release.server", () => ({
  loadGlobalRelease,
}));

const { GlobalReleaseGate } = await import("./global-release-gate");

const gated = <span>gated</span>;

const closed = <span>closed</span>;

const renderShell = (fallback?: ReactNode) =>
  GlobalReleaseGate({
    flag: "referrals",
    isEnabled,
    children: gated,
    fallback,
  });

type RequestGateProps = {
  readonly isEnabled: () => Promise<boolean>;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
};

type RequestGateBoundary = ReactElement<{
  children: ReactElement<RequestGateProps>;
  fallback: ReactNode;
}>;

/** Renders the per-request gate inside the Suspense boundary. */
const renderRequestGate = async (fallback?: ReactNode) => {
  const boundary = (await renderShell(fallback)) as RequestGateBoundary;
  const gate = boundary.props.children;
  const render = gate.type as (props: RequestGateProps) => Promise<ReactNode>;
  return render(gate.props);
};

describe("GlobalReleaseGate", () => {
  beforeEach(() => {
    events.length = 0;
    release = "undecided";
    isEnabled.mockImplementation(async () => {
      events.push("flag");
      return false;
    });
  });

  test("renders the children in the static shell while the flag is on for everyone", async () => {
    release = "on";

    expect(await renderShell()).toBe(gated);
    expect(events).toEqual(["release:referrals"]);
  });

  test("renders nothing in the static shell while the flag is off for everyone", async () => {
    release = "off";

    expect(await renderShell()).toBeNull();
    expect(events).toEqual(["release:referrals"]);
  });

  test("reads an undecided gate after the request-bound render starts", async () => {
    expect(await renderRequestGate()).toBeNull();
    expect(events).toEqual(["release:referrals", "connection", "flag"]);
  });

  test("renders the children when the request's gate is on", async () => {
    isEnabled.mockImplementation(async () => true);

    expect(await renderRequestGate()).toBe(gated);
  });

  test("renders the fallback in the static shell while the flag is off for everyone", async () => {
    release = "off";

    expect(await renderShell(closed)).toBe(closed);
  });

  test("shows the fallback in the static shell while an undecided gate is pending", async () => {
    const boundary = (await renderShell(closed)) as RequestGateBoundary;

    expect(boundary.props.fallback).toBe(closed);
    expect(events).toEqual(["release:referrals"]);
  });

  test("renders the fallback when the request's gate is off", async () => {
    expect(await renderRequestGate(closed)).toBe(closed);
  });
});
