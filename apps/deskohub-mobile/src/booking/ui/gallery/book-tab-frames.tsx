import type {
  CustomerOffering,
  CustomerReservationFamily,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { ReactNode } from "react";
import { CustomerViewError } from "../../../customer-api/customer-view-error";
import { useAppLocale } from "../../../i18n/locale-context";
import { m } from "../../../i18n/messages";
import { useSample } from "../../../ui/gallery/gallery-kit";
import { Masthead } from "../../../ui/masthead";
import { ScrollScreen } from "../../../ui/scroll-screen";
import type { BookingRead } from "../../family/booking-family-view";
import { BookingReadView } from "../../family/booking-read-view";
import { SpaceCards, SpaceCardsSkeleton } from "../../family/space-cards";
import { spaceCards } from "../../family/space-chooser";
import { sampleOfferings } from "../../testing/sample-booking-catalog";
import type { BoardFrame } from "./board-frames";

const ignore = () => undefined;

/** The Book tab's root over `read`, as its screen renders it. */
function BookTab({ read }: { readonly read: BookingRead<ReactNode> }) {
  const locale = useAppLocale();
  return (
    <ScrollScreen
      masthead={<Masthead title={m.booking_stack_title({}, { locale })} />}
    >
      <BookingReadView
        read={read}
        onRetry={ignore}
        loading={
          <SpaceCardsSkeleton label={m.account_loading({}, { locale })} />
        }
        failedTitle={m.booking_spaces_load_failed({}, { locale })}
      >
        {(content) => content}
      </BookingReadView>
    </ScrollScreen>
  );
}

/** The sample catalog's cards with `off` switched off, as the catalog omits them. */
function CardsWithout({
  off,
}: {
  readonly off: ReadonlyArray<CustomerReservationFamily>;
}) {
  const locale = useAppLocale();
  const sample = useSample();
  const offerings = sampleOfferings(locale, "2026-11-10")
    .offerings.filter(({ family }) => !off.includes(family))
    .map(
      (offering): CustomerOffering =>
        offering.family === "meeting-room"
          ? {
              ...offering,
              name: sample(offering.name),
              facts: offering.facts.map((fact) => ({
                ...fact,
                text: sample(fact.text),
              })),
            }
          : { ...offering, name: sample(offering.name) }
    );
  return (
    <BookTab
      read={{
        kind: "loaded",
        refreshing: false,
        value: (
          <SpaceCards
            cards={spaceCards(offerings)}
            locale={locale}
            onOpen={ignore}
          />
        ),
      }}
    />
  );
}

/**
 * Boards 25 and 25b: the Book tab's cards over the sample catalog, with
 * spaces switched off as the catalog omits them, loading and failed.
 */
export const bookTabFrames: ReadonlyArray<BoardFrame> = [
  {
    key: "book-tab",
    board: "25",
    state: "Book tab",
    Screen: () => <CardsWithout off={[]} />,
  },
  {
    key: "book-tab-loading",
    board: "25",
    state: "Loading",
    Screen: () => <BookTab read={{ kind: "loading" }} />,
  },
  {
    key: "book-tab-failed",
    board: "25b",
    state: "Couldn't load",
    Screen: () => (
      <BookTab
        read={{
          kind: "failed",
          error: CustomerViewError.Unavailable(),
          value: Option.none(),
          retrying: false,
        }}
      />
    ),
  },
  {
    key: "book-tab-office-off",
    board: "25b",
    state: "Office switched off",
    Screen: () => <CardsWithout off={["office"]} />,
  },
  {
    key: "book-tab-meeting-room-off",
    board: "25b",
    state: "Meeting room switched off",
    Screen: () => <CardsWithout off={["meeting-room"]} />,
  },
  {
    key: "book-tab-cowork-only",
    board: "25b",
    state: "Only the cowork desk on",
    Screen: () => <CardsWithout off={["office", "meeting-room"]} />,
  },
];
