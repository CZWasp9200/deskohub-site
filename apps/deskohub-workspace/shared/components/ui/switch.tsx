"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";
import { cn } from "@/shared/utils";

interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  ref?: React.Ref<React.ComponentRef<typeof SwitchPrimitive.Root>>;
  /** A small icon shown inside the knob, such as a lucide icon. */
  icon?: React.ReactNode;
}

function Switch({ className, icon, ref, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-navy-blue/45 bg-navy-blue/18 p-0.5 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:border-burned-orange data-[state=checked]:bg-burned-orange",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-navy-blue/60 shadow-sm transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:text-burned-orange [&>svg]:h-3 [&>svg]:w-3">
        {icon}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

export { Switch };
