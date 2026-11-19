import { cva } from "class-variance-authority";

/**
 * An underlined link inside running text. Unlike the Button `link` variant it
 * wraps with the sentence. `light` suits light backgrounds, `inverse` dark ones,
 * and `inherit` keeps the sentence's own font and colour, adding only the
 * underline.
 */
export const textLink = cva(
  "underline underline-offset-4 transition-colors focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4",
  {
    variants: {
      tone: {
        light:
          "font-semibold text-burned-orange-ink decoration-burned-orange/40 hover:decoration-burned-orange focus-visible:outline-burned-orange",
        inverse:
          "font-semibold text-sunset-yellow decoration-sunset-yellow/40 hover:decoration-sunset-yellow focus-visible:outline-sunset-yellow",
        inherit:
          "decoration-current/50 hover:decoration-current focus-visible:outline-burned-orange",
      },
    },
    defaultVariants: { tone: "light" },
  }
);
