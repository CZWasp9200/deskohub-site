import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReservationPage, ReservationPageTitle } from "./reservation-page";

const renderPage = (heading: ReactNode) =>
  renderToStaticMarkup(
    <ReservationPage fallback="Loading" heading={heading} locale="en-US">
      Reservation form
    </ReservationPage>
  );

test("shows the page title as the visible h1 of the reservation page", () => {
  expect(renderPage(<ReservationPageTitle title="Page title" />)).toMatch(
    /<h1(?![^>]*\bsr-only\b)[^>]*>Page title<\/h1>/
  );
});

test("keeps a visually hidden title as the page's only h1", () => {
  const html = renderPage(
    <ReservationPageTitle title="Page title" visuallyHidden />
  );

  expect(html).toMatch(/<h1 class="sr-only">Page title<\/h1>/);
  expect(html.match(/<h1\b/g)).toHaveLength(1);
});
