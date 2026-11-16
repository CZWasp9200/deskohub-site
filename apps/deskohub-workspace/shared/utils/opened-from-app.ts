// The mobile app marks every website page it opens with `native=1`, the
// signal its own web sign-in page reads as well. The proxy imports this
// module, so it stays free of other imports.

const openedFromAppParam = "native";
const openedFromAppValue = "1";

/** Whether the query says the mobile app opened the page: exactly one `native=1`. */
export const isOpenedFromApp = (searchParams: URLSearchParams) => {
  const values = searchParams.getAll(openedFromAppParam);
  return values.length === 1 && values[0] === openedFromAppValue;
};

const sentinelOrigin = "https://opened-from-app.invalid";

/**
 * A same-site path with the mobile app's signal added, so following it from
 * a page the app opened keeps the app's variant. The path's own query and
 * fragment stay; a signal it already carries is replaced, not repeated.
 */
export const withOpenedFromApp = (path: string): string => {
  const url = new URL(path, sentinelOrigin);
  url.searchParams.set(openedFromAppParam, openedFromAppValue);
  return `${url.pathname}${url.search}${url.hash}`;
};
