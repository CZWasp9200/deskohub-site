import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { withOpenedFromApp } from "@/shared/utils/opened-from-app";
import { findLegalDocumentOfPathname } from "./legal-document-path";

type LegalElementProps = {
  readonly children?: ReactNode;
  readonly href?: string;
};

const sentinelOrigin = "https://in-app-legal-links.invalid";

const isNodeList = (node: ReactNode): node is readonly ReactNode[] =>
  Array.isArray(node);

// Authored links to other legal documents are same-site paths; mail and
// external links never are.
const isLegalDocumentHref = (href: string) =>
  href.startsWith("/") &&
  !href.startsWith("//") &&
  findLegalDocumentOfPathname(new URL(href, sentinelOrigin).pathname) !==
    undefined;

const keepElementLinksInApp = (
  element: ReactElement<LegalElementProps>
): ReactElement<LegalElementProps> => {
  const { children, href } = element.props;
  if (element.type === "a" && href !== undefined) {
    return isLegalDocumentHref(href)
      ? cloneElement(element, { href: withOpenedFromApp(href) })
      : element;
  }
  if (children === undefined) return element;
  // Authored children pass on as they were given, a list as separate
  // arguments, so React sees the same children and keys it validated.
  return isNodeList(children)
    ? cloneElement(element, undefined, ...children.map(keepLegalLinksInApp))
    : cloneElement(element, undefined, keepLegalLinksInApp(children));
};

/**
 * The authored legal body as the mobile app's variant renders it: a link to
 * another legal document carries the app's signal, so following it keeps the
 * app's variant. The text, and the document version hashed from it, stay as
 * authored; every other node renders unchanged.
 */
export const keepLegalLinksInApp = (node: ReactNode): ReactNode => {
  if (isNodeList(node)) {
    return node.map(keepLegalLinksInApp);
  }
  return isValidElement<LegalElementProps>(node)
    ? keepElementLinksInApp(node)
    : node;
};
