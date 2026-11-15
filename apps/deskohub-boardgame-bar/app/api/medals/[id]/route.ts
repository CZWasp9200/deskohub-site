import { and, eq, exists } from "drizzle-orm";
import { getAccountsDatabase } from "@/db/database.server";
import { eventMedals, trophies } from "@/db/schema";

const notFound = () => new Response(null, { status: 404 });

/**
 * GET /api/medals/:id
 *
 * The picture of a themed medal. Only medals that someone has been awarded
 * are served, so a medal the operator prepared for an upcoming event stays
 * a surprise until it is handed out.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const medalId = Number((await params).id);
  if (!(Number.isInteger(medalId) && medalId > 0)) return notFound();

  const database = getAccountsDatabase();
  if (!database) return notFound();

  const [medal] = await database
    .select({ mimeType: eventMedals.mimeType, image: eventMedals.image })
    .from(eventMedals)
    .where(
      and(
        eq(eventMedals.id, medalId),
        exists(
          database
            .select({ id: trophies.id })
            .from(trophies)
            .where(eq(trophies.medalId, eventMedals.id))
        )
      )
    );
  if (!medal) return notFound();

  return new Response(new Uint8Array(medal.image), {
    headers: {
      "Content-Type": medal.mimeType,
      // The operator can't replace a medal's picture, only delete an unawarded
      // medal, so an awarded medal's picture never changes.
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
