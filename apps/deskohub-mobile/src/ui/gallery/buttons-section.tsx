import Key from "lucide-react-native/icons/key";
import Mail from "lucide-react-native/icons/mail";
import { Button, ButtonRow } from "../controls";
import { GalleryCase, GallerySection, useSample } from "./gallery-kit";

const ignore = () => undefined;

/** Board 00b part 4: every button variant and state. */
export function ButtonsSection() {
  const sample = useSample();
  return (
    <GallerySection title="Buttons">
      <GalleryCase label="Primary, with icon">
        <Button
          label={sample("Continue with email")}
          icon={Mail}
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Secondary">
        <Button
          label={sample("Sign in with a passkey")}
          icon={Key}
          variant="secondary"
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Busy, and disabled beside it">
        <ButtonRow>
          <Button label={sample("Saving…")} busy onPress={ignore} />
          <Button label={sample("Save changes")} disabled onPress={ignore} />
        </ButtonRow>
      </GalleryCase>
      <GalleryCase label="Going busy keeps the size: idle, then busy">
        <Button label={sample("Save")} width="content" onPress={ignore} />
        <Button label={sample("Save")} width="content" busy onPress={ignore} />
        <Button
          label={sample("Send the confirmation code again by email")}
          onPress={ignore}
        />
        <Button
          label={sample("Send the confirmation code again by email")}
          busy
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Disabled with a reason">
        <Button
          label={sample("Save changes")}
          disabled
          disabledReason={sample("No changes to save")}
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Disabled with the reason below">
        <Button
          label={sample("Continue")}
          disabled
          disabledReason={sample("Choose a date to continue")}
          reasonPlacement="below"
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Danger">
        <Button
          label={sample("Delete permanently")}
          variant="danger"
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Danger, busy">
        <Button
          label={sample("Deleting…")}
          variant="danger"
          busy
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Text (tinted), quiet and danger text">
        <ButtonRow>
          <Button
            label={sample("Resend code")}
            variant="text"
            width="content"
            onPress={ignore}
          />
          <Button
            label={sample("Discard changes")}
            variant="dangerText"
            width="content"
            onPress={ignore}
          />
        </ButtonRow>
        <Button
          label={sample("Not now")}
          variant="quiet"
          width="content"
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Secondary disabled">
        <Button
          label={sample("Add a passkey")}
          variant="secondary"
          disabled
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Small">
        <Button
          label={sample("Copy")}
          size="small"
          width="content"
          variant="secondary"
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Inverse, on navy" surface="navy">
        <Button
          label={sample("Open the app")}
          variant="inverse"
          onPress={ignore}
        />
      </GalleryCase>
    </GallerySection>
  );
}
