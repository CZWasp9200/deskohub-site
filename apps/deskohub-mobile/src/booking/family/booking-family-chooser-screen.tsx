import type { CustomerBookingOfferings } from "@deskohub/workspace-customer-api";
import { useRouter } from "expo-router";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { ListGroup, ListRow } from "../../ui/list";
import { Masthead } from "../../ui/masthead";
import { ScrollScreen } from "../../ui/scroll-screen";
import { bookFamilyHref } from "../booking-routes";
import { bookingFamilyChoices } from "./booking-family-chooser";
import { familyDescription, familyTitle } from "./booking-family-copy";
import { BookingGate } from "./booking-gate";
import { BookingOfferingsView } from "./booking-offerings-view";

/**
 * The Book tab's root: under its masthead, the families to book with
 * today's advertised "from" prices, for an account that can book.
 */
export function BookingFamilyChooserScreen() {
  const locale = useAppLocale();
  return (
    <ScrollScreen
      masthead={<Masthead title={m.booking_stack_title({}, { locale })} />}
    >
      <BookingGate>
        <BookingOfferingsView>
          {(catalog) => <BookingFamilyChoices catalog={catalog} />}
        </BookingOfferingsView>
      </BookingGate>
    </ScrollScreen>
  );
}

function BookingFamilyChoices({
  catalog,
}: {
  readonly catalog: CustomerBookingOfferings;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  return (
    <>
      <ListGroup>
        {bookingFamilyChoices(catalog.offerings).map(
          ({ family, fromPrice }) => (
            <ListRow
              key={family}
              label={familyTitle(family, locale)}
              description={familyDescription(family, locale)}
              value={m.booking_family_from_price(
                { price: formatMoney(fromPrice, locale) },
                { locale }
              )}
              onPress={() => router.push(bookFamilyHref(family))}
            />
          )
        )}
      </ListGroup>
      <ListGroup>
        <ListRow
          label={m.booking_opening_hours(
            { hours: catalog.openingHours },
            { locale }
          )}
        />
      </ListGroup>
    </>
  );
}
