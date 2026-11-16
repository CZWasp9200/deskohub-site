import { and, eq, exists } from "drizzle-orm";
import { headers } from "next/headers";
import { getAccountsDatabase } from "@/db/database.server";
import { eventMedals, trophies } from "@/db/schema";
import { getAuth } from "@/features/account/backend/auth.server";

const notFound = () => new Response(null, { status: 404 });

/** The picture types the admin app accepts for a medal. */
const medalImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * GET /api/medals/:id
 *
 * The picture of a themed medal, for the customer who was awarded it. Anyone
 * else, a signed-out visitor, or the customer after the operator removed the
 * award gets a 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const medalId = Number((await params).id);
  if (!(Number.isInteger(medalId) && medalId > 0)) return notFound();

  const database = getAccountsDatabase();
  const session = await getAuth()?.api.getSession({ headers: await headers() });
  if (!(database && session)) return notFound();

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
            .where(
              and(
                eq(trophies.medalId, eventMedals.id),
                eq(trophies.userId, session.user.id)
              )
            )
        )
      )
    );
  if (!(medal && medalImageTypes.has(medal.mimeType))) return notFound();

  return new Response(new Uint8Array(medal.image), {
    headers: {
      "Content-Type": medal.mimeType,
      // Only for this customer, and checked again on every view, so a
      // removed award stops showing at once.
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      // A picture opened directly can't run scripts.
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
