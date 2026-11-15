import { EmptyAndSkeletonCases } from "./empty-skeleton-cases";
import { GallerySection } from "./gallery-kit";

/** Boards 00 and 00e: toasts, empty states, skeletons and loading. */
export function FeedbackSection() {
  return (
    <GallerySection title="Toast, empty states, skeletons, loading">
      <EmptyAndSkeletonCases />
    </GallerySection>
  );
}
