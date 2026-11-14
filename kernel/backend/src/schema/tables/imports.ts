import type {
	IngestionActivity,
	IngestionBlockReason,
	IngestionCapture,
	IngestionIssue,
	IngestionPins,
	IngestionPlan,
} from "@ryot-app/contract/modules/imports/ingestion";
import type {
	ImportRunFailureReason,
	ImportRunStatus,
} from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunSource } from "@ryot-app/contract/modules/imports/types";
import type {
	IntegrationExtraSettings,
	IntegrationProvider,
	IntegrationProviderSettings,
} from "@ryot-app/contract/modules/integrations/schemas";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	primaryKey,
	snakeCase,
	text,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import type { PreparedIngestionReleaseCiphertext } from "#modules/imports/runtime/prepared-release";

import { user } from "./auth";
import { pluginInstallation } from "./core";
import { timestamptz, updatedAtColumn } from "./timestamps";

export const integration = snakeCase.table(
	"integration",
	{
		name: text(),
		webhookToken: text(),
		pluginInstallationId: text(),
		updatedAt: updatedAtColumn(),
		lastFinishedAt: timestamptz(),
		retiring: boolean().notNull().default(false),
		lot: text().notNull().$type<IntegrationLot>(),
		isDisabled: boolean().notNull().default(false),
		createdAt: timestamptz().defaultNow().notNull(),
		syncOwnership: boolean().notNull().default(false),
		minimumProgress: numeric().notNull().default("2"),
		maximumProgress: numeric().notNull().default("95"),
		provider: text().$type<IntegrationProvider>().notNull(),
		extraSettings: jsonb().$type<IntegrationExtraSettings>().notNull(),
		providerSpecifics: jsonb().$type<IntegrationProviderSettings>().notNull(),
		clientProviderSpecifics: jsonb().$type<IntegrationProviderSettings>().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		index("integration_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
		index("integration_user_id_provider_idx").on(table.userId, table.provider),
		index("integration_plugin_installation_id_idx").on(table.pluginInstallationId),
		index("integration_lot_is_disabled_idx").on(table.lot, table.isDisabled),
		index("integration_provider_is_disabled_idx").on(table.provider, table.isDisabled),
		uniqueIndex("integration_webhook_token_unique").on(table.webhookToken),
		unique("integration_oauth_owner_unique").on(
			table.id,
			table.userId,
			table.pluginInstallationId,
			table.provider,
		),
		unique("integration_run_owner_unique").on(table.id, table.userId),
		check(
			"integration_owner_check",
			sql`(${table.pluginInstallationId} is null and ${table.provider} = 'data-json' and ${table.lot} = 'sink') or (${table.pluginInstallationId} is not null and ${table.provider} <> 'data-json')`,
		),
		check(
			"integration_webhook_token_lot_check",
			sql`(${table.lot} = 'sink') = (${table.webhookToken} is not null)`,
		),
		foreignKey({
			columns: [table.pluginInstallationId, table.userId],
			foreignColumns: [pluginInstallation.id, pluginInstallation.userId],
		}).onDelete("cascade"),
	],
);

export const importRun = snakeCase.table(
	"import_run",
	{
		startedAt: timestamptz(),
		finishedAt: timestamptz(),
		blockDeadline: timestamptz(),
		updatedAt: updatedAtColumn(),
		autoDisabledAt: timestamptz(),
		plan: jsonb().$type<IngestionPlan>(),
		pins: jsonb().$type<IngestionPins>(),
		integrationLot: text().$type<IntegrationLot>(),
		createdAt: timestamptz().defaultNow().notNull(),
		source: text().notNull().$type<ImportRunSource>(),
		collectionSealed: boolean().notNull().default(false),
		expiryReason: text().$type<"setup-deadline-expired">(),
		failureReason: jsonb().$type<ImportRunFailureReason>(),
		preparedRelease: jsonb().$type<PreparedIngestionReleaseCiphertext>(),
		status: text().notNull().$type<ImportRunStatus>().default("pending"),
		inputSummary: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		integrationId: text().references(() => integration.id, { onDelete: "cascade" }),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		blockReasons: jsonb().$type<ReadonlyArray<IngestionBlockReason>>().notNull().default([]),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		pluginInstallationId: text().references(() => pluginInstallation.id, { onDelete: "set null" }),
	},
	(table) => [
		unique("import_run_owner_unique").on(table.id, table.userId),
		check(
			"import_run_prepared_release_check",
			sql`${table.preparedRelease} is null or (${table.pins} is not null and (${table.plan} is null or ${table.plan} = ${table.preparedRelease}->'plan'))`,
		),
		foreignKey({
			columns: [table.integrationId, table.userId],
			foreignColumns: [integration.id, integration.userId],
		}).onDelete("cascade"),
		index("import_run_block_deadline_idx")
			.on(table.blockDeadline)
			.where(sql`${table.status} = 'blocked'`),
		check(
			"import_run_block_check",
			sql`${table.status} <> 'blocked' or (${table.integrationLot} = 'sink' and ${table.blockDeadline} = ${table.createdAt} + interval '168 hours')`,
		),
		check(
			"import_run_expiry_check",
			sql`(${table.status} = 'expired') = (${table.expiryReason} is not null)`,
		),
		index("import_run_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
		index("import_run_integration_id_created_at_idx").on(
			table.integrationId,
			table.createdAt.desc(),
		),
		index("import_run_plugin_installation_id_idx").on(table.pluginInstallationId),
		uniqueIndex("import_run_integration_active_unique")
			.on(table.integrationId)
			.where(
				sql`${table.integrationLot} = 'yank' and ${table.status} in ('pending', 'blocked', 'running', 'cancelling')`,
			),
		check(
			"import_run_status_check",
			sql`${table.status} in ('pending', 'blocked', 'expired', 'running', 'cancelling', 'completed', 'failed', 'cancelled')`,
		),
		check(
			"import_run_integration_lot_check",
			sql`(${table.integrationId} is null) = (${table.integrationLot} is null)`,
		),
	],
);

export const importActivity = snakeCase.table(
	"import_activity",
	{
		data: jsonb().$type<IngestionActivity>().notNull(),
		parentId: text().generatedAlwaysAs(sql`data->>'parentId'`),
		id: text()
			.notNull()
			.generatedAlwaysAs(sql`data->>'id'`),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.id] }),
		foreignKey({ columns: [table.runId, table.parentId], foreignColumns: [table.runId, table.id] }),
		check("import_activity_parent_check", sql`${table.id} is distinct from ${table.parentId}`),
	],
);

export const importItem = snakeCase.table(
	"import_item",
	{
		id: text().notNull(),
		/** Base64 of a small payload not yet published, so a restart can write it again. */
		recoveryBytes: text(),
		operationIds: text().array(),
		/** A batch's result for later chunks, once applied. */
		result: jsonb().$type<JsonValue>(),
		data: jsonb().$type<unknown>().notNull(),
		released: boolean().notNull().default(false),
		retiring: boolean().notNull().default(false),
		published: boolean().notNull().default(false),
		writeStarted: boolean().notNull().default(false),
		captureReleased: boolean().notNull().default(false),
		captureId: text().generatedAlwaysAs(sql`data->>'captureId'`),
		ordinal: integer().generatedAlwaysAs(sql`(data->>'ordinal')::integer`),
		kind: text().$type<"batch" | "result" | "outcome" | "payload">().notNull(),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
		phase: text()
			.$type<IngestionCapture["phase"]>()
			.generatedAlwaysAs(sql`data->>'phase'`),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.kind, table.id] }),
		uniqueIndex("import_item_payload_ordinal_unique")
			.on(table.runId, table.phase, table.ordinal)
			.where(sql`${table.kind} = 'payload'`),
		uniqueIndex("import_item_batch_ordinal_unique")
			.on(table.runId, table.ordinal)
			.where(sql`${table.kind} = 'batch'`),
		check(
			"import_item_kind_check",
			sql`${table.kind} in ('payload', 'batch', 'outcome', 'result')`,
		),
		check("import_item_ordinal_check", sql`${table.ordinal} >= 0`),
		check(
			"import_item_phase_check",
			sql`${table.kind} <> 'payload' or ${table.phase} in ('collection', 'application')`,
		),
		check(
			"import_item_batch_check",
			sql`${table.kind} <> 'batch' or (${table.ordinal} is not null and ${table.captureId} is not null and ${table.operationIds} is not null)`,
		),
		check(
			"import_item_staging_check",
			sql`${table.kind} <> 'payload' or (${table.ordinal} is null) = (data->>'stagingExecutionId' is not null)`,
		),
		check(
			"import_item_recovery_check",
			sql`${table.recoveryBytes} is null or length(${table.recoveryBytes}) <= 5592408`,
		),
	],
);

export const importIssue = snakeCase.table(
	"import_issue",
	{
		data: jsonb().$type<IngestionIssue>().notNull(),
		id: text()
			.notNull()
			.generatedAlwaysAs(sql`data->>'id'`),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.runId, table.id] })],
);
