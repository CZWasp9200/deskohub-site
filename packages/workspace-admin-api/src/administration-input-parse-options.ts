import type { SchemaAST } from "effect";

/**
 * Every strict administration input reports all of its issues and refuses
 * fields it doesn't know. Its endpoint applies these as its payload and query
 * parse options, on the server and in the `dhw` client; the input schemas
 * carry none, so code that decodes one directly passes these.
 */
export const administrationInputParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const satisfies SchemaAST.ParseOptions;
