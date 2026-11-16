import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { AppLocaleProvider } from "../../i18n/locale-context";
import {
  elementTree,
  type HostProps,
  hostTree,
} from "../../ui/testing/element-tree";

/** Places a component under the app's locale, as the sign-in page has it. */
export const inEnglish = (component: ReactElement) => (
  <AppLocaleProvider locale="en-US">{component}</AppLocaleProvider>
);

/** The host elements `component` renders for `props`, in English. */
export const shownTree = <Props,>(
  component: (props: Props) => ReactNode,
  props: Props
): ReactNode => hostTree(elementTree(component, props, inEnglish), inEnglish);

/** Every element of a tree, in document order. */
export const inOrder = (
  node: ReactNode
): ReadonlyArray<ReactElement<HostProps>> =>
  isValidElement<HostProps>(node)
    ? [node, ...Children.toArray(node.props.children).flatMap(inOrder)]
    : [];
