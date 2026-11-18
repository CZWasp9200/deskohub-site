import {
  GalleryCase,
  GallerySection,
  useSample,
} from "../ui/gallery/gallery-kit";
import { UpdateBannerCard } from "./update-banner";
import { UpdateOfferCard } from "./update-offer-card";

const ignore = () => undefined;

/**
 * The two presentations of the one update offer: the quiet card on the
 * critical flows, on paper and on the navy sign-in masthead, and the
 * prominent banner everywhere else.
 */
export function UpdateOfferSection() {
  const sample = useSample();
  const release = {
    message: sample("Version 0.2.3 of the app is available."),
    acceptLabel: sample("Download"),
    dismissLabel: sample("Not now"),
    onAccept: ignore,
    onDismiss: ignore,
  };
  const ready = {
    ...release,
    message: sample("An app update is ready. Restart to use it."),
    acceptLabel: sample("Restart"),
  };
  return (
    <GallerySection title="Update offer">
      <GalleryCase label="Quiet card on paper (booking, onboarding)">
        <UpdateOfferCard {...release} backdrop="paper" />
      </GalleryCase>
      <GalleryCase label="Quiet card on navy (sign-in masthead)" surface="navy">
        <UpdateOfferCard {...release} backdrop="navy" />
      </GalleryCase>
      <GalleryCase label="Quiet card: a downloaded update">
        <UpdateOfferCard {...ready} backdrop="paper" />
      </GalleryCase>
      <GalleryCase label="Prominent banner (tab screens and the rest)">
        <UpdateBannerCard {...release} />
      </GalleryCase>
    </GallerySection>
  );
}
