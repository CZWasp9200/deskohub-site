import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

/** Downloads the signed-in customer's data. */
export function AccountDataExport() {
  return (
    <div className="rounded-md border border-white/15 p-4">
      <h3 className="font-medium text-white">{m["account.export.title"]()}</h3>
      <p className="mt-1 text-sm text-gray-300">{m["account.export.body"]()}</p>
      <Button
        asChild
        variant="outline"
        className="mt-4 bg-transparent text-white hover:bg-white/10"
      >
        <a href="/api/account/data-export" download>
          {m["account.export.download"]()}
        </a>
      </Button>
    </div>
  );
}
