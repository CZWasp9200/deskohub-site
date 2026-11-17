import { describe, expect, mock, test } from "bun:test";
import { expoRouterStandIn } from "../../../testing/expo-router-stand-in";

// The frames' screens link expo-router through the status bar and the
// booking bar; Bun can't load the real module.
mock.module("expo-router", () => expoRouterStandIn());

const { boardFrames } = await import("./board-frames");

describe("board frames", () => {
  test("each frame has its own URL-safe key", () => {
    const keys = boardFrames.map((frame) => frame.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("each frame names a booking board, in board order", () => {
    const boards = boardFrames.map((frame) => frame.board);
    for (const board of boards) {
      expect(board).toMatch(/^(2[5-9]|3[0-6])[bc]?$/);
    }
    expect(boards).toEqual(
      [...boards].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    );
  });
});
