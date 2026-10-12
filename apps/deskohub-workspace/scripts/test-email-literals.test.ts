import { describe, expect, test } from "bun:test";
import {
  findTestEmailLiterals,
  isTestEmailLiteralPath,
} from "./test-email-literals";

// Fixture sources are assembled from parts so this module stays clean.
const join = (...parts: readonly string[]) => parts.join("");
const at = join("", "@");
const address = join("ada", at, "example.com");
const asset = join("icon", at, "2x.png");
const percent = join("%4", "0");
const entities = [join("&#6", "4;"), join("&#x4", "0;"), join("&com", "mat;")];
const escapes = [join("\\", "x40"), join("\\", "u0040"), join("\\", "u{40}")];
const encodings = [...escapes, percent, ...entities];

const statement = (expression: string) =>
  `export const value = ${expression};\n`;
const quoted = (text: string) => `"${text}"`;
const chain = (...parts: readonly string[]) => statement(parts.join(" + "));

const findings = (source: string, fileName = "contact.test.tsx") =>
  findTestEmailLiterals(fileName, source).map(({ address: found }) => found);

const rejected: readonly (readonly [string, string])[] = [
  ["an address literal", statement(quoted(address))],
  [
    "a hand-written domain after a template expression",
    statement(`\`delivered+\${runId}${join(at, "resend.dev")}\``),
  ],
  ["a mailto literal", statement(quoted(join("mailto:", address)))],
  ["a display-name address", statement(quoted(join("Ada <", address, ">")))],
  ["a JSX text address", statement(`<p>${address}</p>`)],
  [
    "a concatenated hand-written domain",
    chain(quoted("ada"), quoted(join(at, "example.com"))),
  ],
  [
    "an address split after the @",
    chain(quoted(join("ada", at)), quoted("example.com")),
  ],
  ...encodings.map(
    (encoding) =>
      [
        `an address with ${encoding} for @`,
        statement(quoted(join("ada", encoding, "example.com"))),
      ] as const
  ),
  ...encodings.map(
    (encoding) =>
      [
        `a mailto address with ${encoding} for @`,
        statement(quoted(join("mailto:ada", encoding, "example.com"))),
      ] as const
  ),
  [
    "a three-part concatenation",
    chain(quoted("ada"), quoted(at), quoted("example.com")),
  ],
  [
    "a four-part concatenation split inside labels",
    chain(
      quoted("ad"),
      quoted("a"),
      quoted(join(at, "exam")),
      quoted("ple.com")
    ),
  ],
  [
    "a concatenation of template literals",
    chain("`ada`", `\`${at}\``, "`example.com`"),
  ],
  [
    "a mixed four-part concatenation",
    chain(quoted("ada"), `\`${at}\``, quoted("example"), "`.com`"),
  ],
  [
    "a concatenation grouped on the left",
    statement(`(${quoted("ada")} + ${quoted(at)}) + ${quoted("example.com")}`),
  ],
  [
    "a concatenation grouped on the right",
    statement(`${quoted("ada")} + (${quoted(at)} + ${quoted("example.com")})`),
  ],
  [
    "a literal concatenation after a non-literal part",
    chain("prefix", quoted("ada"), quoted(at), quoted("example.com")),
  ],
];

const permitted: readonly (readonly [string, string])[] = [
  [
    "the shared helper",
    'import { testEmailAddress } from "@deskohub/email/testing";\nexport const recipient = testEmailAddress("ada");\n',
  ],
  [
    "addresses built from expressions",
    statement(`\`\${localPart}${at}\${domain}\``),
  ],
  [
    "URL credentials",
    statement(
      quoted(
        join("postgresql://owner:secret", at, "ep-preview.eu.neon.tech/neondb")
      )
    ),
  ],
  [
    "a URL host after interpolated credentials",
    statement(`\`https://user:\${secret}${join(at, "example.com")}/app.js\``),
  ],
  ["package specifiers", statement(quoted("@deskohub/email/testing"))],
  [
    "concatenated URL credentials",
    chain(
      quoted("postgresql://owner:"),
      quoted(join("secret", at, "ep-preview.eu.neon.tech/db"))
    ),
  ],
  [
    "an encoded @ without a domain",
    statement(quoted(join("50", percent, "off"))),
  ],
  [
    "a URL-encoded @ in an asset URL",
    statement(quoted(join("https://example.com/icon", percent, "2x.png"))),
  ],
  [
    "an entity-encoded @ in an asset name",
    statement(
      `<img alt="" src="${join("icon", entities[2] ?? "", "2x.png")}" />`
    ),
  ],
  ["a plain retina asset name", statement(quoted(asset))],
  [
    "a URL-encoded @ in a path or query that is not an address",
    statement(
      quoted(
        join(
          "https://cdn.example.com/users/team",
          percent,
          "home/avatar?q=",
          percent,
          "mention"
        )
      )
    ),
  ],
  [
    "a concatenated asset name",
    chain(quoted("icon"), quoted(join(at, "2x.png"))),
  ],
  [
    "a concatenation of non-literal parts",
    chain("prefix", quoted(at), "suffix"),
  ],
  [
    "several asset names in one literal",
    statement(quoted(join(asset, " ", join("logo", at, "3x.webp")))),
  ],
];

describe("findTestEmailLiterals", () => {
  test.each(rejected)("rejects %s", (_name, source) => {
    expect(findings(source)).not.toEqual([]);
  });

  test.each(permitted)("permits %s", (_name, source) => {
    expect(findings(source)).toEqual([]);
  });

  test("checks each token of a literal on its own", () => {
    expect(findings(statement(quoted(join(address, " ", asset))))).toEqual([
      address,
    ]);
    expect(findings(statement(quoted(join(asset, " ", address))))).toEqual([
      address,
    ]);
    expect(
      findings(
        statement(quoted(join(address, ", ", join("bob", at, "example.org"))))
      )
    ).toEqual([address, join("bob", at, "example.org")]);
  });

  test("reports a folded chain once, at its first literal", () => {
    const source = chain(quoted("ada"), quoted(at), quoted("example.com"));
    expect(findTestEmailLiterals("contact.test.ts", source)).toEqual([
      { address, column: 22, line: 1 },
    ]);
  });
});

describe("isTestEmailLiteralPath", () => {
  test.each([
    "apps/deskohub-workspace/features/contact/contact.test.ts",
    "apps/deskohub-workspace/features/contact/contact.test.tsx",
    "apps/deskohub-workspace/e2e/cases/contact.ts",
    "apps/deskohub-workspace/emails/_fixtures/preview-props.ts",
    "apps/deskohub-workspace/shared/testing/fixture.ts",
    "packages/dotypos/src/backend/service.test.ts",
    "packages/example/src/service.test.mjs",
    "apps/deskohub-workspace/scripts/posthog-identity-browser.ts",
  ])("covers %s", (path) => {
    expect(isTestEmailLiteralPath(path)).toBe(true);
  });

  test.each([
    "apps/deskohub-workspace/features/contact/contact.service.ts",
    "apps/deskohub-workspace/next.config.mjs",
  ])("skips production module %s", (path) => {
    expect(isTestEmailLiteralPath(path)).toBe(false);
  });
});
