import type { AutomationTriggerPayload } from "@ryot-app/contract/modules/automations/lifecycle";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin, pluginConfigRevision, pluginRevision, sandboxScript } from "./core";

export const mutationReceipt = snakeCase.table(
	"mutation_receipt",
	{
		batchId: text(),
		workflowName: text(),
		batchIndex: integer(),
		id: text().primaryKey(),
		executionId: text().notNull(),
		commandKind: text().notNull(),
		itemIdentity: text().notNull(),
		rootExecutionId: text().notNull(),
		inputFingerprint: text().notNull(),
		result: jsonb().$type<JsonValue>(),
		dispatch: jsonb().$type<JsonValue>().notNull(),
		evidence: jsonb().$type<AutomationTriggerPayload>(),
		accountGeneration: jsonb().$type<AccountGeneration>(),
		mutationScope: text().$type<"global" | "user">().notNull(),
		recordedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		ownerUserId: text().references(() => user.id, { onDelete: "cascade" }),
		scopeUserId: text().references(() => user.id, { onDelete: "cascade" }),
		pluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
		sandboxScriptId: text().references(() => sandboxScript.id, { onDelete: "restrict" }),
		pluginRevisionId: text().references(() => pluginRevision.id, { onDelete: "restrict" }),
		pluginConfigRevisionId: text().references(() => pluginConfigRevision.id, {
			onDelete: "restrict",
		}),
		receiptType: text()
			.$type<"item" | "batch-decision" | "batch-candidate" | "workflow-owner">()
			.notNull(),
	},
	(table) => [
		index("mutation_receipt_execution_idx").on(table.executionId, table.receiptType),
		index("mutation_receipt_owner_idx").on(table.ownerUserId, table.executionId),
		index("mutation_receipt_scope_idx").on(table.scopeUserId, table.executionId),
		index("mutation_receipt_batch_idx").on(table.batchId, table.receiptType),
		index("mutation_receipt_revision_idx").on(table.pluginRevisionId),
		index("mutation_receipt_config_idx").on(table.pluginConfigRevisionId),
		index("mutation_receipt_script_idx").on(table.sandboxScriptId),
		check(
			"mutation_receipt_scope_check",
			sql`(${table.mutationScope} = 'global' and ${table.scopeUserId} is null) or (${table.mutationScope} = 'user' and ${table.scopeUserId} is not null and ${table.ownerUserId} is not null)`,
		),
		check(
			"mutation_receipt_type_check",
			sql`${table.receiptType} in ('item', 'batch-decision', 'batch-candidate', 'workflow-owner')`,
		),
		check(
			"mutation_receipt_workflow_owner_check",
			sql`(${table.receiptType} = 'workflow-owner' and ${table.workflowName} is not null and ${table.ownerUserId} is not null and ${table.accountGeneration} is not null) or (${table.receiptType} <> 'workflow-owner' and ${table.workflowName} is null)`,
		),
	],
);
