import type { ComponentType } from "react";
import { FlowGallerySection } from "./flow-section";
import { PriceGallerySection } from "./price-section";

/**
 * The booking gallery's sections by URL key. Each section renders its own
 * scrolling body, so a section can show a full-screen frame with a pinned
 * booking bar.
 */
export const bookingGallerySections = [
  {
    key: "flow",
    title: "Steps, calendar and hold timer",
    Section: FlowGallerySection,
  },
  {
    key: "price",
    title: "Booking bar and price breakdown",
    Section: PriceGallerySection,
  },
] as const satisfies ReadonlyArray<{
  readonly key: string;
  readonly title: string;
  readonly Section: ComponentType;
}>;
