import { expect, test } from "bun:test";
import { createLocaleRedirectResponse } from "./locale-routing";

test("locale redirect keeps campaign query parameters", () => {
  const search = "?utm_source=newsletter&utm_campaign=launch&gclid=abc";
  const response = createLocaleRedirectResponse(
    new Request(`https://www.deskohub.cz/${search}`)
  );

  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  expect(new URL(location ?? "").search).toBe(search);
});
