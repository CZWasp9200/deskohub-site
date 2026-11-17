import { useEffect, useState } from "react";
import { BottomSheet } from "../bottom-sheet";
import { ConfirmDialog } from "../confirm-dialog";
import { Button } from "../controls";
import { Dialog } from "../dialog";
import { ListGroup, ListRow } from "../list";
import { ToastCases } from "./feedback-section";
import { GalleryCase, GallerySection, useSample } from "./gallery-kit";

type Overlay = "guard" | "destructive" | "busy" | "sheet";

const countries = ["Czechia", "Slovakia", "Germany"] as const;

/** Board 00e part 10: buttons that open each overlay in each state. */
export function OverlaysSection() {
  const sample = useSample();
  const [open, setOpen] = useState<Overlay>();
  const [country, setCountry] = useState<string>(countries[0]);
  const close = () => setOpen(undefined);
  // A busy confirmation can't be dismissed: it ends on its own here, as the
  // action it waits for would.
  useEffect(() => {
    if (open !== "busy") return;
    const timer = setTimeout(() => setOpen(undefined), 3000);
    return () => clearTimeout(timer);
  }, [open]);
  const opener = (overlay: Overlay, label: string) => (
    <Button
      label={label}
      variant="secondary"
      onPress={() => setOpen(overlay)}
    />
  );
  return (
    <>
      <GallerySection title="Dialog">
        <GalleryCase label="Guard: safe action first">
          {opener("guard", "Open the guard dialog")}
        </GalleryCase>
        <GalleryCase label="Destructive confirmation">
          {opener("destructive", "Open the destructive confirmation")}
        </GalleryCase>
        <GalleryCase label="Destructive confirmation, busy">
          {opener("busy", "Open it busy")}
        </GalleryCase>
      </GallerySection>
      <GallerySection title="Bottom sheet">
        <GalleryCase label="Country picker">
          {opener("sheet", `Pick a country (${country})`)}
        </GalleryCase>
      </GallerySection>
      <GallerySection title="Toast">
        <ToastCases />
      </GallerySection>
      <Dialog
        visible={open === "guard"}
        title={sample("Discard your changes?")}
        body={sample("Your edits to your profile haven’t been saved.")}
        onDismiss={close}
        actions={[
          <Button key="keep" label={sample("Keep editing")} onPress={close} />,
          <Button
            key="discard"
            label={sample("Discard changes")}
            variant="dangerText"
            onPress={close}
          />,
        ]}
      />
      <ConfirmDialog
        visible={open === "destructive" || open === "busy"}
        destructive
        busy={open === "busy"}
        busyMessage={sample("Deleting your account…")}
        title={sample("Permanently delete this account?")}
        body={sample(
          "This signs you out, removes your login and every session, and expires your customer profile. It can’t be undone."
        )}
        confirmLabel={sample("Delete permanently")}
        cancelLabel={sample("Keep account")}
        onConfirm={() => setOpen("busy")}
        onCancel={close}
      />
      <BottomSheet
        visible={open === "sheet"}
        title={sample("Country")}
        onDismiss={close}
      >
        <ListGroup>
          {countries.map((name) => (
            <ListRow
              key={name}
              kind="action"
              label={sample(name)}
              selected={name === country}
              onPress={() => {
                setCountry(name);
                close();
              }}
            />
          ))}
        </ListGroup>
      </BottomSheet>
    </>
  );
}
