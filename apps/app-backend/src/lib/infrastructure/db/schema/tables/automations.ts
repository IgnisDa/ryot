import type {
	AutomationOrigin,
	SignalAudiencePolicy,
} from "@ryot/contract/modules/automations/schemas";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { entity } from "./entities";

export const signalSchema = pgTable(
	"signal_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		catalogState: text().notNull(),
		isBuiltin: boolean().notNull().default(false),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		audiencePolicy: jsonb().$type<SignalAudiencePolicy>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("signal_schema_user_id_idx").on(table.userId),
		unique("signal_schema_user_slug_unique").on(table.userId, table.slug),
		uniqueIndex("signal_schema_global_slug_unique")
			.on(table.slug)
			.where(sql`${table.userId} is null`),
		check("signal_schema_catalog_state_check", sql`${table.catalogState} in ('active', 'hidden')`),
	],
);

export const signal = pgTable(
	"signal",
	{
		id: text().notNull().primaryKey(),
		origin: jsonb().$type<AutomationOrigin>().notNull(),
		properties: jsonb().$type<Record<string, unknown>>().notNull(),
		occurredAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		actorUserId: text().references(() => user.id, { onDelete: "cascade" }),
		signalSchemaId: text()
			.notNull()
			.references(() => signalSchema.id, { onDelete: "cascade" }),
		subjectEntityId: text().references(() => entity.id, { onDelete: "set null" }),
	},
	(table) => [
		index("signal_actor_user_id_idx").on(table.actorUserId),
		index("signal_signal_schema_id_idx").on(table.signalSchemaId),
		index("signal_subject_entity_id_idx").on(table.subjectEntityId),
	],
);

export const signalRecipient = pgTable(
	"signal_recipient",
	{
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		signalId: text()
			.notNull()
			.references(() => signal.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("signal_recipient_user_id_idx").on(table.userId),
		primaryKey({ columns: [table.signalId, table.userId] }),
	],
);
