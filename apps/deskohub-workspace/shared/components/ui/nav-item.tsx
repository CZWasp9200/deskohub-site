import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/utils";

const navItemVariants = cva(
  "inline-flex cursor-pointer items-center gap-3 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-burned-orange disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      layout: {
        row: "min-h-10 w-full justify-start rounded-2xl px-3 py-2 text-left leading-snug whitespace-normal",
        tab: "min-h-11 justify-center rounded-none px-3 whitespace-nowrap md:rounded-2xl",
      },
      tone: {
        neutral: "",
        danger: "",
      },
      active: {
        true: "text-white",
        false: "",
      },
    },
    compoundVariants: [
      {
        tone: "neutral",
        active: false,
        class:
          "text-[#344258] hover:bg-[#f3f5f8] hover:text-navy-blue [&_svg]:text-[#718096]",
      },
      { tone: "neutral", active: true, class: "bg-navy-blue" },
      {
        tone: "danger",
        active: false,
        class: "text-[#d71945] hover:bg-[#fff1f4]",
      },
      { tone: "danger", active: true, class: "bg-[#e71545]" },
    ],
    defaultVariants: { layout: "row", tone: "neutral", active: false },
  }
);

type NavItemProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-current" | "className"
> & {
  /** Marks the item as the current location (`aria-current`). */
  readonly active?: boolean;
  /** Renders the child element (usually a link) as the item. */
  readonly asChild?: boolean;
  /** Parent layout only, as for `Button`. */
  readonly className?: string;
  /** The kind of location the active item represents. */
  readonly current?: "page" | "location" | "step";
  /** `row` stacks in a sidebar or menu; `tab` sits in a horizontal strip. */
  readonly layout?: "row" | "tab";
  readonly ref?: React.Ref<HTMLButtonElement>;
  readonly tone?: "neutral" | "danger";
};

/**
 * One entry of a navigation list. The active entry is filled and announced
 * with `aria-current`. Icons inside are sized and tinted for the state.
 */
function NavItem({
  active = false,
  asChild = false,
  className,
  current = "page",
  layout,
  ref,
  tone,
  ...props
}: NavItemProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      aria-current={active ? current : undefined}
      className={cn(navItemVariants({ active, layout, tone }), className)}
      ref={ref}
      {...(asChild ? {} : { type: "button" })}
      {...props}
    />
  );
}

export { NavItem };
