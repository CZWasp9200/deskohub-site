import { customerMcpServerUrl } from "@/features/account/customer-agent-routes";
import { type Locale, m } from "@/features/i18n";

/**
 * The assistants the agent booking picker offers, in display order. Each
 * opens a new chat with the instruction already in it. Only assistants whose
 * link really carries the instruction are listed: Microsoft Copilot drops
 * `?q=` on its sign-in redirect.
 */
export const agentBookingAssistants = ["claude", "chatgpt", "grok"] as const;

export type AgentBookingAssistant = (typeof agentBookingAssistants)[number];

const assistantChats: Readonly<
  Record<
    AgentBookingAssistant,
    { readonly name: string; readonly newChatUrl: string }
  >
> = {
  claude: { name: "Claude", newChatUrl: "https://claude.ai/new" },
  chatgpt: { name: "ChatGPT", newChatUrl: "https://chatgpt.com/" },
  grok: { name: "Grok", newChatUrl: "https://grok.com/" },
};

/** The assistant's product name, the same in every locale. */
export const getAssistantName = (assistant: AgentBookingAssistant): string =>
  assistantChats[assistant].name;

/**
 * Asks the assistant to connect the customer MCP server and say what it can
 * do for a Deskohub Workspace customer.
 */
export const getAgentBookingInstruction = (locale: Locale): string =>
  m.agentBookingInstruction({ mcpServerUrl: customerMcpServerUrl }, { locale });

/** A new chat in the assistant with `instruction` in its composer. */
export const getAssistantChatUrl = (
  assistant: AgentBookingAssistant,
  instruction: string
): string =>
  `${assistantChats[assistant].newChatUrl}?q=${encodeURIComponent(instruction)}`;
