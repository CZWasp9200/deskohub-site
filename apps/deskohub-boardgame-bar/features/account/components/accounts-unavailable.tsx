import { m } from "@/features/i18n";

/** Shown when the deployment has no accounts database configured. */
export function AccountsUnavailable() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 text-center" role="alert">
      <h2 className="text-2xl font-bold">
        {m["accounts.unavailable.title"]()}
      </h2>
      <p className="mt-3 text-gray-300">{m["accounts.unavailable.hint"]()}</p>
    </section>
  );
}
