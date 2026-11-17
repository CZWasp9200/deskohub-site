import { describe, expect, test } from "bun:test";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { customerMcpServerUrl } from "@/features/account/customer-agent-routes";
import {
  agentBookingAssistants,
  getAgentBookingInstruction,
  getAssistantChatUrl,
} from "./agent-booking-assistants";

describe("agent booking assistants", () => {
  test("every locale's instruction names the customer MCP server", () => {
    for (const locale of supportedLocales) {
      expect(getAgentBookingInstruction(locale)).toContain(
        customerMcpServerUrl
      );
    }
  });

  test("each chat link is an https URL whose q parameter is the whole instruction", () => {
    const instruction = getAgentBookingInstruction("cs-CZ");

    for (const assistant of agentBookingAssistants) {
      const url = new URL(getAssistantChatUrl(assistant, instruction));
      expect(url.protocol).toBe("https:");
      expect(url.searchParams.get("q")).toBe(instruction);
    }
  });
});
