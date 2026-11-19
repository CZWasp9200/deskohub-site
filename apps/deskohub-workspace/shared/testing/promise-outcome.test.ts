import { expect, test } from "bun:test";
import { outcomeOf, rejectionOf } from "./promise-outcome.test-utils";

test("outcomeOf replays a rejection for toThrow", async () => {
  const replay = await outcomeOf(Promise.reject(new TypeError("closed")));
  expect(replay).toThrow(TypeError);
  expect(replay).toThrow("closed");
  expect(() => expect(replay).toThrow("open")).toThrow();
});

test("outcomeOf makes toThrow fail when the promise fulfils", async () => {
  const replay = await outcomeOf(Promise.resolve("ready"));
  expect(replay()).toBe("ready");
  expect(() => expect(replay).toThrow()).toThrow();
});

test("rejectionOf returns the rejection reason itself", async () => {
  const reason = new Error("unavailable");
  expect(await rejectionOf(Promise.reject(reason))).toBe(reason);
});

test("rejectionOf fails when the promise fulfils", async () => {
  const replay = await outcomeOf(rejectionOf(Promise.resolve({ ready: true })));
  expect(replay).toThrow();
});
