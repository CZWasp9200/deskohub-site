import { describe, expect, test } from "bun:test";
import Monitor from "lucide-react-native/icons/monitor";
import type { ReactElement } from "react";
import {
  elementTree,
  findAll,
  type HostProps,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { BookingTicket } from "./booking-ticket";

const texts = (detail?: string) =>
  findAll(
    hostTree(
      elementTree(BookingTicket, {
        lead: undefined,
        badge: { label: "Confirmed", tone: "positive" },
        date: undefined,
        title: "Reserved Desk",
        lines: [],
        meta: [
          {
            key: "monitor",
            icon: Monitor,
            text: "Monitor workstation",
            ...(detail !== undefined && { detail }),
          },
        ],
      })
    ),
    "Text"
  ).map((element) => textOf(element as ReactElement<HostProps>));

describe("BookingTicket", () => {
  test("draws a meta line's detail right under its text", () => {
    const all = texts("2× 27″ QHD");
    const line = all.indexOf("Monitor workstation");
    expect(line).toBeGreaterThan(-1);
    expect(all[line + 1]).toBe("2× 27″ QHD");
  });

  test("draws nothing under a meta line without a detail", () => {
    expect(texts()).not.toContain("2× 27″ QHD");
  });
});
