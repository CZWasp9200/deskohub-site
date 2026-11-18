import { describe, expect, test } from "bun:test";
import { reset } from "expo-router/build/react-navigation/routers/CommonActions";
import { StackRouter } from "expo-router/build/react-navigation/routers/StackRouter";
import type { NavigationState } from "expo-router/react-navigation";
import {
  bookingFamilyReset,
  signedInDestination,
} from "./signed-in-destination";

describe("the signed-in rail", () => {
  test("reserves the product highlight for a Choose route or its checkout", () => {
    expect(
      signedInDestination(["(account)", "(tabs)", "book"])
    ).toBeUndefined();
    expect(signedInDestination(["(account)", "book", "meeting-room"])).toBe(
      "meeting-room"
    );
    expect(
      signedInDestination(["(account)", "book", "checkout"], "office")
    ).toBe("office");
    expect(
      signedInDestination(["(account)", "book", "profile"], "cowork")
    ).toBe("cowork");
  });

  test("highlights Reservations on its tab and on a cold-linked access route", () => {
    expect(signedInDestination(["(account)", "(tabs)", "reservations"])).toBe(
      "reservations"
    );
    expect(
      signedInDestination(["(account)", "reservations", "[orderId]", "access"])
    ).toBe("reservations");
  });

  test("keeps account section routes and onboarding distinct", () => {
    expect(
      signedInDestination(["(account)", "(tabs)", "account", "profile"])
    ).toBe("account");
    expect(
      signedInDestination(["(account)", "onboarding", "billing"], "office")
    ).toBeUndefined();
  });

  test("switches products through the installed router and clears checkout history", () => {
    const routeNames = [
      "office",
      "meeting-room",
      "cowork",
      "checkout",
      "profile",
    ];
    const book: NavigationState = {
      stale: false,
      type: "stack",
      key: "book",
      routeKeySeq: 3,
      index: 2,
      routeNames,
      routes: [
        { key: "office-0", name: "office" },
        { key: "checkout-1", name: "checkout" },
        { key: "profile-2", name: "profile" },
      ],
    };
    const root: NavigationState = {
      ...book,
      key: "root",
      index: 0,
      routeNames: ["(account)"],
      routes: [
        {
          key: "account",
          name: "(account)",
          state: {
            ...book,
            key: "account-stack",
            index: 1,
            routeNames: ["(tabs)", "book"],
            routes: [
              { key: "tabs", name: "(tabs)" },
              { key: "booking", name: "book", state: book },
            ],
          },
        },
      ],
    };
    const destination = bookingFamilyReset(root, "meeting-room");
    if (destination === undefined) throw new Error("Missing booking reset");
    expect(destination.target).toBe("book");
    const action = { ...reset(destination.state), target: destination.target };

    const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
    const router = StackRouter(options);
    expect(
      router.getStateForAction({ ...book, type: "stack" }, action, options)
    ).toMatchObject({
      state: { index: 0, routes: [{ name: "meeting-room" }] },
      browserHistory: { type: "pop", count: 2 },
    });
  });
});
