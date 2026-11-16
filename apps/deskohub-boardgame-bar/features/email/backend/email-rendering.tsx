import { createRequire } from "node:module";
import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";

// Turbopack rejects a static `react-dom/server` import when this module is
// pulled into the app-route/server-component graph. Keep it behind require so
// email rendering can stay server-only without breaking the Vercel build.
const require = createRequire(import.meta.url);
const { renderToString } =
  require("react-dom/server") as typeof import("react-dom/server");

/** Styles shared by the customer account emails. */
export const boardgameEmailStyles = {
  container: {
    fontFamily: "Arial, sans-serif",
    maxWidth: "600px",
    margin: "0 auto",
    color: "#1f2937",
  },
  button: {
    display: "inline-block",
    padding: "12px 24px",
    backgroundColor: "#16a34a",
    color: "#ffffff",
    borderRadius: "6px",
    textDecoration: "none",
    fontWeight: "bold",
  },
  muted: { color: "#6b7280", fontSize: "13px" },
} as const satisfies Record<string, CSSProperties>;

export type EmailDetailRow = readonly [label: string, value: ReactNode];

export const renderBoardgameEmailHtml = (children: ReactNode): string =>
  renderToString(children);

export const renderBoardgameEmailDocument = (children: ReactNode): string =>
  `<!DOCTYPE html>${renderToString(children)}`;

export const MultilineEmailText = ({ value }: { readonly value: string }) => (
  <>
    {value.split("\n").map((line, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: Email lines need positional keys because duplicate and blank lines are valid.
      <Fragment key={`${index}:${line}`}>
        {index > 0 ? <br /> : null}
        {line}
      </Fragment>
    ))}
  </>
);

export const BoardgameEmailRow = ({
  label,
  value,
  cellStyle,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly cellStyle: CSSProperties;
}) => (
  <tr>
    <td style={cellStyle}>
      <strong>{label}</strong>
    </td>
    <td style={cellStyle}>{value}</td>
  </tr>
);
