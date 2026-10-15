"use client";

import * as TogglePrimitive from "@radix-ui/react-toggle";
import type * as React from "react";
import { cn } from "@/shared/utils";
import { toggleItemClassName } from "./toggle-group";

function Toggle({
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root>) {
  return (
    <TogglePrimitive.Root
      className={cn(toggleItemClassName, className)}
      {...props}
    />
  );
}

export { Toggle };
