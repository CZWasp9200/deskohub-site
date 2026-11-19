import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../../i18n/app-locale";
import { useAppLocale } from "../../../i18n/locale-context";
import { AppBar } from "../../../ui/app-bar";
import { Card } from "../../../ui/card";
import { Button } from "../../../ui/controls";
import {
  GalleryCase,
  GallerySection,
  useSample,
} from "../../../ui/gallery/gallery-kit";
import { ScrollScreen } from "../../../ui/scroll-screen";
import { Text } from "../../../ui/text";
import { color, space } from "../../../ui/tokens";
import type { PragueDate } from "../../selection/prague-date";
import { type BookingStep, BookingSteps } from "../booking-steps";
import {
  HoldChip,
  HoldEndedDialog,
  type HoldStatus,
  HoldStatusChip,
} from "../hold-timer";
import { MonthCalendar } from "../month-calendar";
import {
  coworkDates,
  officeDates,
  officeRange,
  galleryToday as today,
} from "./gallery-fixtures";

const held: HoldStatus = { secondsLeft: 597, phase: "held" };
const ending: HoldStatus = { secondsLeft: 58, phase: "ending" };
const ended: HoldStatus = { secondsLeft: 0, phase: "ended" };

const liveSeconds = 65;
const expiryIn = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toISOString();

/**
 * The booking flow's pieces (boards 26–36): step progress, calendar states,
 * the hold chip in each phase with a live one, the end-of-hold dialog, and
 * full-screen frames composed like the boards for device captures.
 */
export function FlowGallerySection() {
  const locale = useAppLocale();
  const sample = useSample();
  const [chosen, setChosen] = useState<PragueDate>("2026-11-26");
  const [focused, setFocused] = useState<PragueDate>();
  const [liveExpiry, setLiveExpiry] = useState(() => expiryIn(liveSeconds));
  const [dialogOpen, setDialogOpen] = useState(false);
  const closeDialog = () => setDialogOpen(false);
  const fullDayInfo = sample(
    "Fri 20 Nov is full for Open Space. A reserved desk is still free that day, or pick another date."
  );

  const calendar = (
    props: Partial<Parameters<typeof MonthCalendar>[0]> = {}
  ) => (
    <MonthCalendar
      label="Date"
      locale={locale}
      dates={coworkDates}
      selected={undefined}
      onSelect={setChosen}
      previousMonthLabel="Previous month"
      nextMonthLabel="Next month"
      unavailableLabel="not available"
      today={today}
      {...props}
    />
  );
  const unavailableCalendar = calendar({
    focusedDate: focused,
    onUnavailablePress: setFocused,
    dayInfo: focused === undefined ? undefined : fullDayInfo,
    legend: false,
  });

  return (
    <ScrollScreen>
      <GallerySection title="Step progress">
        {(["choose", "details", "pay"] as const).map((step) => (
          <GalleryCase key={step} label={`Step: ${step}`}>
            <BookingSteps current={step} locale={locale} />
          </GalleryCase>
        ))}
        <GalleryCase label="Raised: the body scrolled under it">
          <View>
            <BookingSteps current="details" raised locale={locale} />
            <Text variant="bodySmall" style={styles.under}>
              {sample("Content scrolled under the steps fades out below them.")}
            </Text>
          </View>
        </GalleryCase>
      </GallerySection>

      <GallerySection title="Calendar">
        <GalleryCase label="Start: no date chosen, today ringed, a full day struck">
          {calendar()}
        </GalleryCase>
        <GalleryCase label="Chosen">
          {calendar({ selected: chosen, legend: false })}
        </GalleryCase>
        <GalleryCase label="Unavailable day tapped: tap the 20th">
          {unavailableCalendar}
        </GalleryCase>
        <GalleryCase label="Office range">
          {calendar({
            dates: officeDates,
            selected: officeRange.start,
            range: officeRange,
            legend: false,
          })}
        </GalleryCase>
        <GalleryCase label="Disabled">
          {calendar({ selected: chosen, disabled: true })}
        </GalleryCase>
      </GallerySection>

      <GallerySection title="Hold chip">
        <GalleryCase label="9:57 held">
          <ChipBar status={held} locale={locale} />
        </GalleryCase>
        <GalleryCase label="0:58 ending: amber">
          <ChipBar status={ending} locale={locale} />
        </GalleryCase>
        <GalleryCase label="0:00 ended">
          <ChipBar status={ended} locale={locale} />
        </GalleryCase>
        <GalleryCase label="Live from 1:05: turns amber at 1:00">
          <AppBar
            title="Review and pay"
            onBack={() => undefined}
            actions={<HoldChip expiresAt={liveExpiry} locale={locale} />}
          />
          <Button
            label="Restart from 1:05"
            variant="secondary"
            onPress={() => setLiveExpiry(expiryIn(liveSeconds))}
          />
        </GalleryCase>
      </GallerySection>

      <GallerySection title="End of hold">
        <GalleryCase label="Dialog">
          <Button
            label="Show the end-of-hold dialog"
            variant="secondary"
            onPress={() => setDialogOpen(true)}
          />
        </GalleryCase>
      </GallerySection>

      <GallerySection title="Full-screen frames">
        <Frame title="Cowork desk" step="choose" locale={locale}>
          {calendar()}
        </Frame>
        <Frame title="Cowork desk" step="choose" raised locale={locale}>
          {unavailableCalendar}
        </Frame>
        <Frame title="Private office" step="choose" locale={locale}>
          {calendar({
            dates: officeDates,
            selected: officeRange.start,
            range: officeRange,
            legend: false,
          })}
        </Frame>
        <Frame title="Your details" step="details" locale={locale}>
          <FixtureCard text={sample("Contact and billing details.")} />
        </Frame>
        <Frame title="Review and pay" step="pay" hold={held} locale={locale}>
          <FixtureCard text={sample("Open Space desk, Thu 26 Nov.")} />
        </Frame>
        <Frame
          title="Review and pay"
          step="pay"
          hold={ending}
          raised
          locale={locale}
        >
          <FixtureCard text={sample("Open Space desk, Thu 26 Nov.")} />
        </Frame>
        <Frame title="Review and pay" step="pay" hold={ended} locale={locale}>
          <FixtureCard text={sample("Open Space desk, Thu 26 Nov.")} />
          <Button
            label="Show the end-of-hold dialog"
            variant="secondary"
            onPress={() => setDialogOpen(true)}
          />
        </Frame>
      </GallerySection>

      <HoldEndedDialog
        visible={dialogOpen}
        onCheckDate={closeDialog}
        onLeave={closeDialog}
        locale={locale}
      />
    </ScrollScreen>
  );
}

/** A hold chip in the app bar, at a fixed time. */
function ChipBar({
  status,
  locale,
}: {
  readonly status: HoldStatus;
  readonly locale: AppLocale;
}) {
  return (
    <AppBar
      title="Review and pay"
      onBack={() => undefined}
      actions={<HoldStatusChip status={status} locale={locale} />}
    />
  );
}

/**
 * A booking step as a full screen: the app bar (with the hold chip from the
 * review on), the step progress and the body, edge to edge.
 */
function Frame({
  title,
  step,
  hold,
  raised = false,
  locale,
  children,
}: {
  readonly title: string;
  readonly step: BookingStep;
  readonly hold?: HoldStatus;
  readonly raised?: boolean;
  readonly locale: AppLocale;
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.frame}>
      <AppBar
        title={title}
        onBack={() => undefined}
        actions={hold && <HoldStatusChip status={hold} locale={locale} />}
      />
      <BookingSteps current={step} raised={raised} locale={locale} />
      <View style={styles.frameBody}>{children}</View>
    </View>
  );
}

function FixtureCard({ text }: { readonly text: string }) {
  return (
    <Card>
      <Text variant="body">{text}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  under: { paddingHorizontal: space.gutter, paddingTop: space.md },
  frame: {
    backgroundColor: color.paper,
    borderColor: color.line,
    borderBottomWidth: 1,
    borderTopWidth: 1,
    marginHorizontal: -space.gutter,
    minHeight: 640,
  },
  frameBody: {
    gap: space.lg,
    paddingBottom: space.xxl,
    paddingHorizontal: space.gutter,
    paddingTop: space.xs,
  },
});
