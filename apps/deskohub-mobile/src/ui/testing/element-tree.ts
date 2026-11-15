import {
  Children,
  cloneElement,
  createElement,
  isValidElement,
  type JSXElementConstructor,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type StyleProp, StyleSheet, type ViewStyle } from "react-native";

export type HostProps = Readonly<Record<string, unknown>> & {
  readonly children?: ReactNode;
};

/**
 * The element tree a component returns for `props`. The component runs
 * inside a throwaway server render, so its hooks work (effects don't run),
 * and the tree isn't rendered further: with the preload's host components
 * standing in as names, a test reads it as returned. `within` places the
 * component under providers, such as a context it reads.
 */
export const elementTree = <Props>(
  component: (props: Props) => ReactNode,
  props: Props,
  within: (component: ReactElement) => ReactElement = (node) => node
): ReactNode => {
  let tree: ReactNode = null;
  const Probe = () => {
    tree = component(props);
    return null;
  };
  renderToStaticMarkup(within(createElement(Probe)));
  return tree;
};

/**
 * `node` with every function component replaced by the tree it returns, so
 * a test reads a composite's host elements down to its leaves. Each
 * component runs as in `elementTree`, a `forwardRef` component included. A
 * class component, such as a native player, stays a leaf: it can't be called
 * as a function. `within` places every component under providers, as in
 * `elementTree`.
 */
export const hostTree = (
  node: ReactNode,
  within: (component: ReactElement) => ReactElement = (inner) => inner
): ReactNode => {
  if (!isValidElement<HostProps>(node)) return node;
  const descend = (child: ReactNode) => hostTree(child, within);
  if (typeof node.type === "function" && !isClassComponent(node.type)) {
    return descend(
      elementTree(
        node.type as (props: HostProps) => ReactNode,
        node.props,
        within
      )
    );
  }
  const forwarded = forwardRefRender(node.type);
  if (forwarded) {
    return descend(
      elementTree(
        (props: HostProps) => forwarded(props, null),
        node.props,
        within
      )
    );
  }
  return node.props.children === undefined
    ? node
    : cloneElement(
        node,
        undefined,
        ...(Children.map(node.props.children, descend) ?? [])
      );
};

// A `forwardRef` component, such as a Lucide icon, is an object holding its
// render function.
const forwardRefRender = (
  type: unknown
): ((props: HostProps, ref: null) => ReactNode) | undefined =>
  typeof type === "object" &&
  type !== null &&
  "render" in type &&
  typeof type.render === "function"
    ? (type.render as (props: HostProps, ref: null) => ReactNode)
    : undefined;

const isClassComponent = (type: JSXElementConstructor<never>): boolean =>
  (type.prototype as { isReactComponent?: unknown } | undefined)
    ?.isReactComponent !== undefined;

/** A host element's text: its string and number children, joined. */
export const textOf = (element: ReactElement<HostProps>): string =>
  Children.toArray(element.props.children)
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join("");

/**
 * Every element of `type` in an element tree, in document order: a host
 * element by its name, or a component's element by the component.
 */
export const findAll = <Props = HostProps>(
  node: ReactNode,
  type: string | JSXElementConstructor<Props>
): ReadonlyArray<ReactElement<Props>> => {
  if (!isValidElement<HostProps>(node)) return [];
  const nested = Children.toArray(node.props.children).flatMap((child) =>
    findAll(child, type)
  );
  return node.type === type
    ? [node as unknown as ReactElement<Props>, ...nested]
    : nested;
};

/** The first element of `type` in an element tree. */
export const find = <Props = HostProps>(
  node: ReactNode,
  type: string | JSXElementConstructor<Props>
): ReactElement<Props> | undefined => findAll(node, type)[0];

/** An element's `style` prop merged as React Native merges it, for asserting on. */
export const flatStyle = (style: unknown): Readonly<Record<string, unknown>> =>
  ({ ...StyleSheet.flatten(style as StyleProp<ViewStyle>) }) as Readonly<
    Record<string, unknown>
  >;
