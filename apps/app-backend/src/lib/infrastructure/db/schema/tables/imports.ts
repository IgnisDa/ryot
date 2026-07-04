import type {
	ImportRunFailureStage,
	ImportRunSource,
	ImportRunStatus,
} from "@ryot/contract/modules/imports/types";
import type {
	IntegrationExtraSettings,
	IntegrationProvider,
	IntegrationProviderSpecifics,
} from "@ryot/contract/modules/integrations/schemas";
import type { IntegrationLot } from "@ryot/contract/modules/integrations/types";
import { generateId } from "better-auth";
import {
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const integration = pgTable(
	"integration",
	{
		name: text(),
		lot: text().notNull().$type<IntegrationLot>(),
		isDisabled: boolean().notNull().default(false),
		provider: text().$type<IntegrationProvider>().notNull(),
		syncOwnership: boolean().notNull().default(false),
		minimumProgress: numeric().notNull().default("2"),
		maximumProgress: numeric().notNull().default("95"),
		lastFinishedAt: timestamp({ withTimezone: true }),
		extraSettings: jsonb().$type<IntegrationExtraSettings>().notNull(),
		providerSpecifics: jsonb().$type<IntegrationProviderSpecifics>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
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
		index("integration_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
		index("integration_user_id_provider_idx").on(table.userId, table.provider),
		index("integration_lot_is_disabled_idx").on(table.lot, table.isDisabled),
		index("integration_provider_is_disabled_idx").on(table.provider, table.isDisabled),
	],
);

export const importRun = pgTable(
	"import_run",
	{
		errorSummary: text(),
		totalItems: integer(),
		progress: integer().notNull().default(0),
		source: text().notNull().$type<ImportRunSource>(),
		failedItems: integer().notNull().default(0),
		importedItems: integer().notNull().default(0),
		startedAt: timestamp({ withTimezone: true }),
		finishedAt: timestamp({ withTimezone: true }),
		processedItems: integer().notNull().default(0),
		status: text().notNull().$type<ImportRunStatus>().default("pending"),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		inputSummary: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		integrationId: text().references(() => integration.id, { onDelete: "cascade" }),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
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
		index("import_run_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
		index("import_run_integration_id_created_at_idx").on(
			table.integrationId,
			table.createdAt.desc(),
		),
	],
);

export const integrationAutoDisableClaim = pgTable(
	"integration_auto_disable_claim",
	{
		importRunId: text().notNull().primaryKey(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		integrationId: text()
			.notNull()
			.references(() => integration.id, { onDelete: "cascade" }),
	},
	(table) => [index("integration_auto_disable_claim_integration_id_idx").on(table.integrationId)],
);

export const importRunFailure = pgTable(
	"import_run_failure",
	{
		sourceLabel: text(),
		eventSchemaSlug: text(),
		sourceIdentifier: text(),
		entitySchemaSlug: text(),
		message: text().notNull(),
		itemIndex: integer().notNull(),
		context: jsonb().$type<Record<string, unknown>>(),
		stage: text().notNull().$type<ImportRunFailureStage>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [index("import_run_failure_run_id_created_at_idx").on(table.runId, table.createdAt)],
);
