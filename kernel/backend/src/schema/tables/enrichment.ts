import type { SandboxFailureKind } from "@ryot-app/contract/errors";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	serial,
	snakeCase,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { sandboxProvider } from "./core";
import { entity } from "./entities";
import { timestamptz } from "./timestamps";

export const ENRICHMENT_WORK_STATES = [
	"queued",
	"running",
	"retrying",
	"succeeded",
	"failed",
	"cancelled",
] as const;

export const entityEnrichmentRequest = snakeCase.table(
	"entity_enrichment_request",
	{
		retryOf: text(),
		language: text(),
		id: text().primaryKey(),
		pluginId: text().notNull(),
		completedAt: timestamptz(),
		requesterGeneration: text(),
		sequence: serial().notNull(),
		externalId: text().notNull(),
		nextAttemptAt: timestamptz(),
		workflowName: text().notNull(),
		entitySchemaSlug: text().notNull(),
		sourceContentGeneration: integer(),
		registrationReleasedAt: timestamptz(),
		level: text().$type<"base" | "full">(),
		attempt: integer().notNull().default(0),
		payload: jsonb().$type<unknown>().notNull(),
		failureKind: text().$type<SandboxFailureKind>(),
		createdAt: timestamptz().notNull().defaultNow(),
		observedAt: timestamptz().notNull().defaultNow(),
		dispatchRoot: boolean().notNull().default(false),
		operation: text().$type<"population" | "translation">().notNull(),
		entityId: text().references(() => entity.id, { onDelete: "cascade" }),
		scopeUserId: text().references(() => user.id, { onDelete: "cascade" }),
		state: text({ enum: ENRICHMENT_WORK_STATES }).notNull().default("queued"),
		requesterUserId: text().references(() => user.id, { onDelete: "cascade" }),
		providerId: text()
			.notNull()
			.references(() => sandboxProvider.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("entity_enrichment_request_entity_idx").on(table.entityId, table.createdAt),
		index("entity_enrichment_request_pending_idx").on(table.state, table.createdAt),
		uniqueIndex("entity_enrichment_request_retry_unique").on(table.retryOf),
		check("entity_enrichment_request_attempt_check", sql`${table.attempt} between 0 and 3`),
		check(
			"entity_enrichment_request_state_check",
			sql`${table.state} in ('queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled')`,
		),
		check(
			"entity_enrichment_request_requester_check",
			sql`(${table.requesterUserId} is null) = (${table.requesterGeneration} is null)`,
		),
		check(
			"entity_enrichment_request_operation_check",
			sql`(${table.operation} = 'population' and ${table.level} in ('base', 'full') and ${table.language} is null) or (${table.operation} = 'translation' and ${table.level} is null and ${table.language} is not null)`,
		),
	],
);
