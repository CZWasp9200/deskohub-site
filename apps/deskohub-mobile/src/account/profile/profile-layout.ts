import { type ContentWidth, useViewport } from "../../ui/viewport";

export function useProfileContentWidth(checkout: boolean): ContentWidth {
  const { fontScale, isExpanded } = useViewport();
  return checkout && isExpanded && fontScale < 1.5 ? "wide" : "form";
}
