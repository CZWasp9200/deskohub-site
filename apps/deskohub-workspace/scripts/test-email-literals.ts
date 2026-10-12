/**
 * Rejects hand-written email addresses in test code. Tests build addresses
 * with `testEmailAddress` (on the EMAIL_TEST_DOMAIN constant, so mail routes to
 * Console) or `resendSimulatorAddress` from `@deskohub/email/testing`; a
 * hand-written address could reach a real inbox.
 *
 * It reads string, template, and JSX literals, folds `+` chains of literals
 * (parentheses included), decodes `\x40`, `@`, `\u{40}` (through the
 * cooked literal value), `%40`, `&#64;`, `&#x40;`, and `&commat;`, and checks
 * every address-shaped token on its own. URL credentials (`user:secret@host`),
 * hosts followed by a path, and asset names such as `icon@2x.png` are not
 * addresses. It is a guardrail, not a security boundary: it does not evaluate
 * `[...].join("@")`, `String.fromCharCode`, or other computed values.
 */
import { resolve } from "node:path";
import ts from "typescript";
import { runCommand } from "./shared/command";

export type TestEmailLiteral = {
  readonly line: number;
  readonly column: number;
  readonly address: string;
};

const testPathPatterns = [
  /\.(?:test|test-utils|test-fixture|pw|mock|spec)\.(?:[cm]?js|jsx|ts|tsx)$/,
  /\/(?:e2e|testing|__tests__|__fixtures__|_fixtures|fixtures|\(testing-only\))\/.*\.(?:[cm]?js|jsx|ts|tsx)$/,
  /(?:-fixture|\/fixtures?)\.(?:[cm]?js|jsx|ts|tsx)$/,
  /apps\/deskohub-workspace\/scripts\/(?:account-visual|account-sticky)\/.*\.(?:ts|tsx)$/,
  /apps\/deskohub-workspace\/scripts\/posthog-identity-browser\.ts$/,
];

/** Test, fixture, E2E, and visual-script modules the rule covers. */
export const isTestEmailLiteralPath = (path: string) =>
  testPathPatterns.some((pattern) => pattern.test(path));

const encodedAt = /%40|&#0*64;|&#x0*40;|&commat;/gi;

const addressToken =
  /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,}))(?![A-Za-z0-9.-])/g;

const assetExtensions = new Set([
  "avif",
  "bmp",
  "cjs",
  "css",
  "gif",
  "htm",
  "html",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "json",
  "map",
  "mjs",
  "mp4",
  "pdf",
  "png",
  "svg",
  "ts",
  "tsx",
  "ttf",
  "txt",
  "webm",
  "webp",
  "woff",
  "woff2",
]);

const isAddressToken = (text: string, match: RegExpMatchArray) => {
  const [token, localPart = "", , extension = ""] = match;
  const start = match.index ?? 0;
  const before = text.slice(0, start);
  const after = text.charAt(start + token.length);

  if (assetExtensions.has(extension.toLowerCase())) return false;
  // A bare `@example.com` hand-writes the domain; after a path or port it is
  // a URL host following interpolated credentials.
  if (localPart === "") return !/^[/:?#]/.test(after);
  if (after === "/") return false;
  if (before.endsWith("/")) return false;
  return !before.endsWith(":") || before.toLowerCase().endsWith("mailto:");
};

/** Address-shaped tokens in one literal value, after decoding `@`. */
const findAddresses = (value: string) => {
  const text = value.replace(encodedAt, "@");
  return [...text.matchAll(addressToken)]
    .filter((match) => isAddressToken(text, match))
    .map(([token]) => token);
};

const unwrapParentheses = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node)
    ? unwrapParentheses(node.expression)
    : node;

const isConcatenation = (node: ts.Node): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.PlusToken;

const isPlainLiteral = (
  node: ts.Node
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

/** The nearest ancestor that is not a parenthesis. */
const enclosingNode = (node: ts.Node): ts.Node | undefined => {
  let ancestor = node.parent;
  while (ancestor && ts.isParenthesizedExpression(ancestor)) {
    ancestor = ancestor.parent;
  }
  return ancestor;
};

/** Flattens a `+` chain, through parentheses, into its operands. */
const concatenationOperands = (node: ts.Expression): ts.Expression[] => {
  const unwrapped = unwrapParentheses(node);
  return isConcatenation(unwrapped)
    ? [
        ...concatenationOperands(unwrapped.left),
        ...concatenationOperands(unwrapped.right),
      ]
    : [unwrapped];
};

const literalValues = (node: ts.Node): readonly string[] => {
  if (isPlainLiteral(node) || ts.isJsxText(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text),
    ];
  }
  return [];
};

const scriptKind = (fileName: string) => {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

/** Finds hand-written addresses in one module's source. */
export const findTestEmailLiterals = (
  fileName: string,
  sourceText: string
): TestEmailLiteral[] => {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName)
  );
  const findings: TestEmailLiteral[] = [];
  const folded = new Set<ts.Node>();

  const report = (node: ts.Node, values: readonly string[]) => {
    for (const value of values) {
      for (const address of findAddresses(value)) {
        const position = source.getLineAndCharacterOfPosition(
          node.getStart(source)
        );
        findings.push({
          address,
          column: position.character + 1,
          line: position.line + 1,
        });
      }
    }
  };

  const visit = (node: ts.Node) => {
    const enclosing = enclosingNode(node);
    const isChainRoot =
      isConcatenation(node) &&
      !(enclosing !== undefined && isConcatenation(enclosing));
    if (isChainRoot) {
      // Adjacent literal operands fold into one value; any other operand
      // breaks the run.
      let run: ts.Expression[] = [];
      const flush = () => {
        const [first] = run;
        if (first) {
          report(first, [
            run
              .map((operand) => (isPlainLiteral(operand) ? operand.text : ""))
              .join(""),
          ]);
        }
        run = [];
      };
      for (const operand of concatenationOperands(node)) {
        if (isPlainLiteral(operand)) {
          run.push(operand);
          folded.add(operand);
        } else {
          flush();
        }
      }
      flush();
    } else if (!folded.has(node)) {
      report(node, literalValues(node));
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return findings;
};

const main = async () => {
  const repositoryRoot = resolve(import.meta.dir, "../../..");
  const listed = await runCommand(
    [
      "git",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "apps",
      "packages",
    ],
    {
      cwd: repositoryRoot,
    }
  );
  if (listed.exitCode !== 0) {
    throw new Error("git ls-files failed while listing test modules");
  }
  const paths = listed.stdout.split("\0").filter(isTestEmailLiteralPath);
  let violations = 0;
  for (const path of paths) {
    const sourceText = await Bun.file(resolve(repositoryRoot, path)).text();
    for (const finding of findTestEmailLiterals(path, sourceText)) {
      violations += 1;
      process.stderr.write(
        `${path}:${finding.line}:${finding.column} Build test email addresses with testEmailAddress or resendSimulatorAddress from @deskohub/email/testing instead of writing them.\n`
      );
    }
  }
  process.stdout.write(
    `Checked ${paths.length} test modules; ${violations} hand-written email addresses.\n`
  );
  if (violations > 0) process.exitCode = 1;
};

if (import.meta.main) await main();
