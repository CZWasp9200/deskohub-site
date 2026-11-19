import { headers } from "next/headers";
import { buildAccountDataExport } from "@/features/account/backend/account-data-export.server";
import { getAuth } from "@/features/account/backend/auth.server";
import { formatDate } from "@/shared/utils/date-formatting";

/**
 * GET /api/account/data-export
 *
 * The signed-in customer's data as a JSON download. Anyone else gets a 404.
 */
export async function GET(): Promise<Response> {
  const session = await getAuth()?.api.getSession({ headers: await headers() });
  const data = session ? await buildAccountDataExport(session.user.id) : null;
  if (!data) return new Response(null, { status: 404 });

  // en-CA writes the bar's calendar date as YYYY-MM-DD.
  const date = formatDate(data.exportedAt, "en-CA", { dateStyle: "short" });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="deskohub-bar-account-${date}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
