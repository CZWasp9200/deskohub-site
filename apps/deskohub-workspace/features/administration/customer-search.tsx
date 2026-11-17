"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { searchAdministrationCustomers } from "./actions";
import { AdministrationLink as Link } from "./admin-link";
import { administrationHref } from "./administration-href";
import type { AdministrationCustomerSearch } from "./customer-directory.service";
import type { AdministrationCustomer } from "./customer-identity";
import {
  formatAdministrationCustomerContact,
  getAdministrationCustomerName,
} from "./customer-presentation";
import { m } from "./i18n";
import { AdministrationAlert } from "./notice";

const createSearchFormSchema = (locale: Locale) =>
  Schema.Struct({
    query: Schema.String.check(
      Schema.makeFilter((value) => value.trim().length >= 2, {
        message: m.administrationCustomerSearchQueryLength({}, { locale }),
      })
    ),
  });

type CustomerSearchResult = {
  readonly kind: AdministrationCustomerSearch["kind"];
  readonly customers: readonly AdministrationCustomer[];
};

/**
 * Searches Dotypos customers by name or email. Each match opens its customer
 * page unless `renderCustomerAction` offers another action for it.
 */
export function CustomerSearch({
  renderCustomerAction,
  variant = "card",
}: {
  readonly renderCustomerAction?: (
    customer: AdministrationCustomer
  ) => ReactNode;
  readonly variant?: "card" | "toolbar" | "inline";
}) {
  const locale = useRouteLocale();
  const [result, setResult] = useState<CustomerSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ query: string }>({
    defaultValues: { query: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(createSearchFormSchema(locale)),
  });
  const { execute, isExecuting } = useWorkspaceAction(
    searchAdministrationCustomers,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        setError(null);
        setResult(data);
      },
      onError: ({ error: actionError }) => {
        setResult(null);
        setError(
          actionError.serverError ??
            m.administrationCustomerSearchFailed({}, { locale })
        );
      },
      onTransportError: () => {
        setResult(null);
        setError(m.administrationCustomerSearchFailed({}, { locale }));
      },
    }
  );

  return (
    <div
      className={
        {
          card: "space-y-4",
          toolbar: "space-y-4",
          inline: "@container space-y-4",
        }[variant]
      }
    >
      <Form {...form}>
        <form
          className={
            {
              card: "grid gap-3 rounded-xl border border-navy-blue/10 bg-white p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
              toolbar:
                "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
              inline:
                "grid gap-3 @md:grid-cols-[minmax(0,1fr)_auto] @md:items-end",
            }[variant]
          }
          noValidate
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            setResult(null);
            const query = values.query.trim();
            if (!query) return;
            execute({ query });
          })}
        >
          <FormField
            control={form.control}
            name="query"
            render={({ field, fieldState }) => (
              <FormItem className="grid gap-1.5">
                <FormLabel>
                  {m.administrationCustomerSearchLabel({}, { locale })}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    minLength={2}
                    placeholder={m.administrationCustomerSearchPlaceholder(
                      {},
                      { locale }
                    )}
                    required
                    type="search"
                    variant={fieldState.error ? "error" : "default"}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button disabled={isExecuting} type="submit">
            <Search aria-hidden className="size-4" />
            {isExecuting
              ? m.administrationCustomerSearching({}, { locale })
              : m.administrationCustomerSearchSubmit({}, { locale })}
          </Button>
        </form>
      </Form>

      {error && (
        <AdministrationAlert
          className="font-semibold"
          role="alert"
          status="error"
        >
          {error}
        </AdministrationAlert>
      )}
      {result && (
        <div
          aria-live="polite"
          className="rounded-xl border border-navy-blue/10 bg-white"
        >
          {result.customers.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-navy-blue/65">
              {m.administrationCustomerSearchEmpty({}, { locale })}
            </p>
          ) : (
            <>
              {result.kind === "ambiguous" && (
                <p className="border-b border-navy-blue/10 px-5 py-3 text-sm text-navy-blue/70">
                  {m.administrationCustomerSearchAmbiguous({}, { locale })}
                </p>
              )}
              <ul className="divide-y divide-navy-blue/10">
                {result.customers.map((customer) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                    key={customer.id}
                  >
                    <div>
                      <p className="font-semibold">
                        {getAdministrationCustomerName(customer, locale)}
                      </p>
                      <p className="mt-1 text-sm text-navy-blue/65">
                        {formatAdministrationCustomerContact(customer, locale)}
                      </p>
                    </div>
                    {renderCustomerAction ? (
                      renderCustomerAction(customer)
                    ) : (
                      <Button asChild size="sm" variant="secondary">
                        <Link
                          href={administrationHref(
                            "/[locale]/admin/customers/[customerId]",
                            { customerId: customer.id }
                          )}
                        >
                          {m.administrationCustomerSearchOpenCustomer(
                            {},
                            { locale }
                          )}
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
