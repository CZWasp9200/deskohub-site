import type { ComponentType } from "react";
import { ButtonsSection } from "./buttons-section";
import { FeedbackSection } from "./feedback-section";
import { FieldsSection } from "./fields-section";
import { FoundationSection } from "./foundation-section";
import { NavigationSection } from "./navigation-section";
import { OverlaysSection } from "./overlays-section";
import { RowsSection } from "./rows-section";
import { SelectionSection } from "./selection-section";
import { StatusSection } from "./status-section";

/** The gallery's sections in board order (boards 00b–00e), by URL key. */
export const gallerySections = [
  {
    key: "foundation",
    title: "Colour, type and icons",
    Section: FoundationSection,
  },
  { key: "buttons", title: "Buttons", Section: ButtonsSection },
  { key: "fields", title: "Text fields", Section: FieldsSection },
  { key: "selection", title: "Selection controls", Section: SelectionSection },
  {
    key: "rows",
    title: "Cards, rows and section headers",
    Section: RowsSection,
  },
  { key: "status", title: "Notices and badges", Section: StatusSection },
  {
    key: "feedback",
    title: "Toast, empty states, skeletons, loading",
    Section: FeedbackSection,
  },
  {
    key: "navigation",
    title: "App bar and masthead",
    Section: NavigationSection,
  },
  {
    key: "overlays",
    title: "Dialog and bottom sheet",
    Section: OverlaysSection,
  },
] as const satisfies ReadonlyArray<{
  readonly key: string;
  readonly title: string;
  readonly Section: ComponentType;
}>;

export type GallerySectionKey = (typeof gallerySections)[number]["key"];
