import type { ContactFormValues } from "@/features/contact/schemas/contact";
import type { Locale } from "@/features/i18n";

/** Contact form fields another page can prefill through the contact page's query. */
export type ContactPrefill = Partial<
  Pick<ContactFormValues, "name" | "email" | "phone" | "message">
>;

/** The longest value the contact page takes from each query parameter. */
const contactPrefillMaxLengths = {
  name: 100,
  email: 255,
  phone: 20,
  message: 1000,
} as const satisfies Record<keyof ContactPrefill, number>;

const contactPrefillFields = Object.keys(
  contactPrefillMaxLengths
) as ReadonlyArray<keyof ContactPrefill>;

/** The contact form values a contact page link prefills, if it names any. */
export const readContactPrefill = (
  params: Pick<URLSearchParams, "get">
): ContactPrefill | undefined => {
  const values: ContactPrefill = Object.fromEntries(
    contactPrefillFields.map((field) => [
      field,
      params.get(field)?.slice(0, contactPrefillMaxLengths[field]),
    ])
  );
  return Object.values(values).some(Boolean) ? values : undefined;
};

/** The locale's contact page with its form prefilled, for in-site links. */
export const getContactPageHref = (locale: Locale, prefill: ContactPrefill) => {
  const query = new URLSearchParams();
  for (const field of contactPrefillFields) {
    const value = prefill[field]?.slice(0, contactPrefillMaxLengths[field]);
    if (value) query.set(field, value);
  }
  const search = query.toString();
  return `/${locale}/contact${search && `?${search}`}`;
};
