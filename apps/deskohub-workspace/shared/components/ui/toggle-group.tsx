"use client";

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import type * as React from "react";
import { cn } from "@/shared/utils";

const toggleItemClassName =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded px-2 text-navy-blue/75 text-sm transition hover:bg-navy-blue/8 hover:text-navy-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange disabled:pointer-events-none disabled:opacity-40 data-[state=on]:bg-navy-blue/12 data-[state=on]:text-navy-blue";

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn("inline-flex items-center gap-0.5", className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(toggleItemClassName, className)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem, toggleItemClassName };
