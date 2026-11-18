import { space } from "../../ui/tokens";
import { contentColumnWidth, useViewport, wideGutter } from "../../ui/viewport";

const minimumFieldWidth = 300;
const stackedFontScale = 1.3;

export function onboardingFieldPairsFit(
  availableWidth: number,
  fontScale: number
) {
  const formWidth = Math.min(
    contentColumnWidth.form,
    availableWidth - 2 * wideGutter
  );
  return (
    fontScale < stackedFontScale &&
    formWidth >= 2 * minimumFieldWidth + space.lg
  );
}

export function useOnboardingLayout() {
  const { availableWidth, fontScale, isWide } = useViewport();
  return {
    isWide,
    pairFields: isWide && onboardingFieldPairsFit(availableWidth, fontScale),
  };
}
