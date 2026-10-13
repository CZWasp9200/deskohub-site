import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { AdministrationDiscountCodeCreateInput } from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema } from "effect";
import { storedDiscountIdSchema } from "@/features/discounts/persistence-contracts";
import {
  CalendarResourceConfig,
  salesCalendarIdSchema,
  workspaceLimitationsCalendarIdSchema,
} from "@/shared/backend/config/calendar-resource.config";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { DiscountAdministration } from "./discount-administration.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "DiscountAdministration conflicts on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const labels: string[] = [];

    afterAll(async () => {
      const discountIds =
        "select id from discounts where labels->>'en-US' = any($1)";
      await testDatabase.pool.query(
        `delete from promotion_codes where id in (select promotion_code_id from discount_codes where discount_id in (${discountIds}))`,
        [labels]
      );
      await testDatabase.pool.query(
        `delete from discount_product_targets where discount_id in (${discountIds})`,
        [labels]
      );
      await testDatabase.pool.query(
        "delete from discounts where labels->>'en-US' = any($1)",
        [labels]
      );
    });

    const run = <A, E>(
      operation: (
        administration: typeof DiscountAdministration.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        DiscountAdministration.pipe(
          Effect.flatMap(operation),
          Effect.provide(
            DiscountAdministration.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  testDatabase.layer,
                  GoogleCalendarServiceMock({}),
                  DotyposServiceMock({}),
                  Layer.succeed(CalendarResourceConfig, {
                    salesCalendarId: salesCalendarIdSchema.make("sales"),
                    workspaceLimitationsCalendarId:
                      workspaceLimitationsCalendarIdSchema.make("limitations"),
                  })
                )
              )
            )
          ),
          Effect.result
        )
      );

    const createDiscountCode = (code: string, label: string) =>
      run((administration) =>
        administration.createCode(
          Schema.decodeUnknownSync(AdministrationDiscountCodeCreateInput)({
            code: {
              code,
              enabled: true,
              validFrom: null,
              validUntil: null,
              maxUses: null,
            },
            discount: {
              kind: "new",
              discount: {
                labels: { "cs-CZ": label, "en-US": label },
                adjustment: { kind: "percentage", basisPoints: 1000 },
                products: [{ kind: "cowork" }],
              },
            },
          })
        )
      );

    const countDiscounts = async (label: string) =>
      (
        await testDatabase.pool.query(
          "select 1 from discounts where labels->>'en-US' = $1",
          [label]
        )
      ).rowCount;

    const uniqueSuffix = () =>
      crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();

    test("rejects a duplicate promotion code and rolls back its new discount", async () => {
      const code = `SYNTHETIC_${uniqueSuffix()}`;
      const firstLabel = `Synthetic first ${code}`;
      const duplicateLabel = `Synthetic duplicate ${code}`;
      labels.push(firstLabel, duplicateLabel);

      expect(await createDiscountCode(code, firstLabel)).toMatchObject({
        _tag: "Success",
      });
      expect(await createDiscountCode(code, duplicateLabel)).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAdminConflictError",
          message: "A promotion code with this value already exists.",
        },
      });
      expect(await countDiscounts(duplicateLabel)).toBe(0);
    });

    test("rejects deleting a discount a code still references", async () => {
      const code = `SYNTHETIC_${uniqueSuffix()}`;
      const label = `Synthetic referenced ${code}`;
      labels.push(label);
      await createDiscountCode(code, label);
      const {
        rows: [discount],
      } = await testDatabase.pool.query<{ id: string }>(
        "select id from discounts where labels->>'en-US' = $1",
        [label]
      );
      const id = storedDiscountIdSchema.make(discount?.id ?? "");

      expect(
        await run((administration) => administration.deleteDiscount({ id }))
      ).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAdminConflictError",
          message:
            "This discount is still referenced by a discount code and cannot be deleted.",
        },
      });
      expect(await countDiscounts(label)).toBe(1);
    });
  }
);
