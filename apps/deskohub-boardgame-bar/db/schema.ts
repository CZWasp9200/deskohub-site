import { defineRelations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgSchema,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Tables of the shared accounts database. The `deskohub-games` admin app
 * owns this database and its migrations; this file only mirrors the shape so
 * the site can query it. When a column changes there
 * (`deskohub-games/src/lib/db/schema.ts`), change it here in the same step.
 */

const authSchema = pgSchema("auth");

export const authUser = authSchema.table(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("user_email_unique_idx").on(t.email)]
);

export const authSession = authSchema.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("session_token_unique_idx").on(t.token),
    index("session_user_id_idx").on(t.userId),
    index("session_expires_at_idx").on(t.expiresAt),
  ]
);

export const authAccount = authSchema.table(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("account_issuer_account_unique_idx").on(t.issuer, t.accountId),
    index("account_user_id_idx").on(t.userId),
  ]
);

export const authVerification = authSchema.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("verification_identifier_idx").on(t.identifier),
    index("verification_expires_at_idx").on(t.expiresAt),
  ]
);

export const authRateLimit = authSchema.table(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("rate_limit_key_unique_idx").on(t.key),
    index("rate_limit_last_request_idx").on(t.lastRequest),
  ]
);

/** The table map the Better Auth Drizzle adapter operates on. */
export const authTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  rateLimit: authRateLimit,
};

export const authRelations = defineRelations(authTables, (r) => ({
  user: {
    sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
    accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
  },
  session: {
    user: r.one.user({ from: r.session.userId, to: r.user.id }),
  },
  account: {
    user: r.one.user({ from: r.account.userId, to: r.user.id }),
  },
}));

/** Only the columns of the board-game catalog that events display. */
export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

export const membershipPlans = pgTable("membership_plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  priceCzk: integer("price_czk").notNull(),
  durationDays: integer("duration_days").notNull(),
  benefits: text("benefits").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MembershipStatus = "requested" | "active" | "cancelled";

export const memberships = pgTable("memberships", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  planId: integer("plan_id")
    .notNull()
    .references(() => membershipPlans.id, { onDelete: "restrict" }),
  status: text("status").$type<MembershipStatus>().notNull(),
  priceCzk: integer("price_czk").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  note: text("note"),
});

export type EventKind = "event" | "tournament";

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  kind: text("kind").$type<EventKind>().notNull(),
  gameId: integer("game_id").references(() => games.id, {
    onDelete: "set null",
  }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  capacity: integer("capacity"),
  entryFee: text("entry_fee"),
  registrationOpen: boolean("registration_open").notNull().default(true),
  published: boolean("published").notNull().default(true),
});

export const eventRegistrations = pgTable("event_registrations", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const trophies = pgTable("trophies", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  eventId: integer("event_id").references(() => events.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  placement: integer("placement"),
  note: text("note"),
  awardedAt: timestamp("awarded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
