import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type {
	ImportRunFailureStage,
	ImportRunSource,
} from "@ryot-app/contract/modules/imports/types";
import type {
	IntegrationExtraSettings,
	IntegrationProvider,
	IntegrationProviderSettings,
} from "@ryot-app/contract/modules/integrations/schemas";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import type { RunStatus } from "@ryot-app/contract/schema/run-status";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	snakeCase,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { pluginInstallation } from "./core";

export const integration = snakeCase.table(
	"integration",
	{
		name: text(),
		pluginInstallationId: text().notNull(),
		lot: text().notNull().$type<IntegrationLot>(),
		isDisabled: boolean().notNull().default(false),
		provider: text().$type<IntegrationProvider>().notNull(),
		syncOwnership: boolean().notNull().default(false),
		minimumProgress: numeric().notNull().default("2"),
		maximumProgress: numeric().notNull().default("95"),
		lastFinishedAt: timestamp({ withTimezone: true }),
		extraSettings: jsonb().$type<IntegrationExtraSettings>().notNull(),
		providerSpecifics: jsonb().$type<IntegrationProviderSettings>().notNull(),
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
		index("integration_plugin_installation_id_idx").on(table.pluginInstallationId),
		index("integration_lot_is_disabled_idx").on(table.lot, table.isDisabled),
		index("integration_provider_is_disabled_idx").on(table.provider, table.isDisabled),
		foreignKey({
			columns: [table.pluginInstallationId, table.userId],
			foreignColumns: [pluginInstallation.id, pluginInstallation.userId],
		}).onDelete("cascade"),
	],
);

export const importRun = snakeCase.table(
	"import_run",
	{
		totalItems: integer(),
		integrationLot: text().$type<IntegrationLot>(),
		progress: integer().notNull().default(0),
		source: text().notNull().$type<ImportRunSource>(),
		failedItems: integer().notNull().default(0),
		importedItems: integer().notNull().default(0),
		startedAt: timestamp({ withTimezone: true }),
		finishedAt: timestamp({ withTimezone: true }),
		processedItems: integer().notNull().default(0),
		failureReason: jsonb().$type<ImportRunFailureReason>(),
		status: text().notNull().$type<RunStatus>().default("pending"),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		inputSummary: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		integrationId: text().references(() => integration.id, { onDelete: "cascade" }),
		pluginInstallationId: text().references(() => pluginInstallation.id, { onDelete: "set null" }),
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
		index("import_run_plugin_installation_id_idx").on(table.pluginInstallationId),
		uniqueIndex("import_run_integration_active_unique")
			.on(table.integrationId)
			.where(sql`${table.integrationLot} = 'yank' and ${table.status} in ('pending', 'running')`),
	],
);

export const integrationAutoDisableClaim = snakeCase.table(
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

export const importRunFailure = snakeCase.table(
	"import_run_failure",
	{
		sourceLabel: text(),
		eventSchemaSlug: text(),
		sourceIdentifier: text(),
		entitySchemaSlug: text(),
		itemIndex: integer().notNull(),
		stage: text().notNull().$type<ImportRunFailureStage>(),
		reason: jsonb().$type<ImportRunFailureReason>().notNull(),
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
