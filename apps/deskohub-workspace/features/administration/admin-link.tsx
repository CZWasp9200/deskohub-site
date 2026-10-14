import NextLink from "next/link";
import type { ComponentProps } from "react";

export function AdministrationLink(props: ComponentProps<typeof NextLink>) {
  return <NextLink {...props} prefetch={false} />;
}

/** A linked summary of a related record on an administration detail page. */
export function AdministrationRecordLink(
  props: Omit<ComponentProps<typeof NextLink>, "className">
) {
  return (
    <AdministrationLink
      {...props}
      className="block rounded-lg px-3 py-3 hover:bg-navy-blue/[0.035]"
    />
  );
}
