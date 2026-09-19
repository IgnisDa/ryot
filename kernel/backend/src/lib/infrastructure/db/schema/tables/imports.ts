import type {
	IngestionActivity,
	IngestionBatch,
	IngestionBlockReason,
	IngestionCapture,
	IngestionIssue,
	IngestionOutcome,
	IngestionPins,
	IngestionPlan,
	IngestionPayload,
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
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import type { PreparedIngestionRelease } from "#modules/imports/runtime/prepared-release";

import { user } from "./auth";
import { pluginInstallation } from "./core";

export const integration = snakeCase.table(
	"integration",
	{
		name: text(),
		webhookToken: text(),
		pluginInstallationId: text(),
		retiring: boolean().notNull().default(false),
		lot: text().notNull().$type<IntegrationLot>(),
		isDisabled: boolean().notNull().default(false),
		syncOwnership: boolean().notNull().default(false),
		minimumProgress: numeric().notNull().default("2"),
		lastFinishedAt: timestamp({ withTimezone: true }),
		maximumProgress: numeric().notNull().default("95"),
		provider: text().$type<IntegrationProvider>().notNull(),
		extraSettings: jsonb().$type<IntegrationExtraSettings>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		providerSpecifics: jsonb().$type<IntegrationProviderSettings>().notNull(),
		clientProviderSpecifics: jsonb().$type<IntegrationProviderSettings>().notNull(),
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
		accountGeneration: text().notNull(),
		plan: jsonb().$type<IngestionPlan>(),
		pins: jsonb().$type<IngestionPins>(),
		startedAt: timestamp({ withTimezone: true }),
		finishedAt: timestamp({ withTimezone: true }),
		integrationLot: text().$type<IntegrationLot>(),
		blockDeadline: timestamp({ withTimezone: true }),
		source: text().notNull().$type<ImportRunSource>(),
		collectionSealed: boolean().notNull().default(false),
		expiryReason: text().$type<"setup-deadline-expired">(),
		failureReason: jsonb().$type<ImportRunFailureReason>(),
		preparedRelease: jsonb().$type<PreparedIngestionRelease>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
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
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		unique("import_run_owner_unique").on(table.id, table.userId, table.accountGeneration),
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
			sql`${table.status} <> 'blocked' or (${table.integrationLot} = 'sink' and ${table.blockDeadline} = ${table.createdAt} + interval '7 days')`,
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
		batchId: text(),
		parentId: text(),
		id: text().notNull(),
		data: jsonb().$type<IngestionActivity>().notNull(),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.id] }),
		foreignKey({ columns: [table.runId, table.parentId], foreignColumns: [table.runId, table.id] }),
		foreignKey({
			columns: [table.runId, table.batchId],
			foreignColumns: [importBatch.runId, importBatch.id],
		}),
		check(
			"import_activity_identity_check",
			sql`${table.id} = ${table.data}->>'id' and ${table.parentId} is not distinct from ${table.data}->>'parentId' and ${table.batchId} is not distinct from ${table.data}->>'batchId' and ${table.id} is distinct from ${table.parentId}`,
		),
	],
);

export const importCapture = snakeCase.table(
	"import_capture",
	{
		id: text().notNull(),
		ordinal: integer().notNull(),
		data: jsonb().$type<IngestionCapture>().notNull(),
		phase: text().$type<IngestionCapture["phase"]>().notNull(),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.id] }),
		unique("import_capture_ordinal_unique").on(table.runId, table.phase, table.ordinal),
		check(
			"import_capture_identity_check",
			sql`${table.id} = ${table.data}->>'id' and ${table.phase} = ${table.data}->>'phase' and ${table.phase} in ('collection', 'application') and ${table.ordinal} = (${table.data}->>'ordinal')::integer and ${table.ordinal} >= 0`,
		),
	],
);

export const importPayloadReservation = snakeCase.table(
	"import_payload_reservation",
	{
		ordinal: integer(),
		id: text().notNull(),
		recoveryBytes: text(),
		stagingExecutionId: text(),
		inputFingerprint: text().notNull(),
		released: boolean().notNull().default(false),
		retiring: boolean().notNull().default(false),
		writeStarted: boolean().notNull().default(false),
		payload: jsonb().$type<IngestionPayload>().notNull(),
		captureState: text().$type<"captured" | "sealed">().notNull(),
		capturePhase: text().$type<IngestionCapture["phase"]>().notNull(),
		checkpoint: jsonb().$type<IngestionCapture["checkpoint"]>().notNull(),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "restrict" }),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.id] }),
		unique("import_payload_reservation_ordinal_unique").on(
			table.runId,
			table.capturePhase,
			table.ordinal,
		),
		check(
			"import_payload_reservation_phase_check",
			sql`${table.capturePhase} in ('collection', 'application')`,
		),
		check("import_payload_reservation_ordinal_check", sql`${table.ordinal} >= 0`),
		check(
			"import_payload_reservation_staging_check",
			sql`(${table.ordinal} is null) = (${table.stagingExecutionId} is not null)`,
		),
		check(
			"import_payload_reservation_recovery_check",
			sql`${table.recoveryBytes} is null or length(${table.recoveryBytes}) <= 5592408`,
		),
	],
);

export const importBatch = snakeCase.table(
	"import_batch",
	{
		id: text().notNull(),
		captureId: text().notNull(),
		ordinal: integer().notNull(),
		executionId: text().notNull(),
		workflowName: text().notNull(),
		operationIds: text().array().notNull(),
		data: jsonb().$type<IngestionBatch>().notNull(),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.id] }),
		unique("import_batch_ordinal_unique").on(table.runId, table.ordinal),
		foreignKey({
			columns: [table.runId, table.captureId],
			foreignColumns: [importCapture.runId, importCapture.id],
		}).onDelete("cascade"),
		check(
			"import_batch_identity_check",
			sql`${table.id} = ${table.data}->>'id' and ${table.captureId} = ${table.data}->>'captureId' and ${table.ordinal} = (${table.data}->>'ordinal')::integer and ${table.ordinal} >= 0`,
		),
	],
);

export const importOutcome = snakeCase.table(
	"import_outcome",
	{
		operationId: text().notNull(),
		data: jsonb().$type<IngestionOutcome>().notNull(),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.operationId] }),
		check(
			"import_outcome_identity_check",
			sql`${table.operationId} = ${table.data}->>'operationId'`,
		),
	],
);

export const importIssue = snakeCase.table(
	"import_issue",
	{
		id: text().notNull(),
		data: jsonb().$type<IngestionIssue>().notNull(),
		runId: text()
			.notNull()
			.references(() => importRun.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.id] }),
		check("import_issue_identity_check", sql`${table.id} = ${table.data}->>'id'`),
	],
);

export const dataImportSubmission = snakeCase.table(
	"data_import_submission",
	{
		key: text().notNull(),
		runId: text().notNull(),
		digest: text().notNull(),
		uploadTokenHashes: text().array().notNull().default([]),
		integrationId: text().references(() => integration.id, { onDelete: "cascade" }),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("data_import_submission_identity_unique").on(
			table.userId,
			sql`coalesce(${table.integrationId}, '')`,
			table.key,
		),
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
