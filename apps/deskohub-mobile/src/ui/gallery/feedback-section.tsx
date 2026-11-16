import { Button } from "../controls";
import { useToast } from "../toast";
import { EmptyAndSkeletonCases } from "./empty-skeleton-cases";
import { GalleryCase, GallerySection, useSample } from "./gallery-kit";

/** Boards 00 and 00e: toasts, empty states, skeletons and loading. */
export function FeedbackSection() {
  return (
    <GallerySection title="Toast, empty states, skeletons, loading">
      <ToastCases />
      <EmptyAndSkeletonCases />
    </GallerySection>
  );
}

/**
 * Board 00e part 10: buttons that show each toast over the screen, above
 * the bottom safe area.
 */
export function ToastCases() {
  const sample = useSample();
  const { show } = useToast();
  return (
    <>
      <GalleryCase label="Confirmation">
        <Button
          label="Show a confirmation"
          variant="secondary"
          onPress={() => show({ message: sample("Profile saved") })}
        />
      </GalleryCase>
      <GalleryCase label="Neutral, with an action">
        <Button
          label="Show a neutral toast"
          variant="secondary"
          onPress={() =>
            show({
              message: sample("Marketing emails turned off"),
              tone: "neutral",
              action: {
                label: sample("Undo"),
                onPress: () => show({ message: sample("Marketing emails on") }),
              },
            })
          }
        />
      </GalleryCase>
    </>
  );
}
