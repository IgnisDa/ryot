import type {
	AssistantApprovalDecision,
	AssistantMessage,
	AssistantMessagePart,
	AssistantToolCall,
	AssistantTurnFailure,
	AssistantTurnStatus,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	snakeCase,
	text,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import type { SubkeyCiphertext } from "#platform/config/plugin-config-encryption";

import { user } from "./auth";
import { timestamptz, updatedAtColumn } from "./timestamps";

export const assistantConversation = snakeCase.table(
	"assistant_conversation",
	{
		id: text().primaryKey(),
		title: text().notNull(),
		updatedAt: updatedAtColumn(),
		revision: integer().notNull().default(1),
		nextSequence: integer().notNull().default(1),
		createdAt: timestamptz().notNull().defaultNow(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(t) => [unique().on(t.id, t.userId)],
);
export const assistantTurn = snakeCase.table(
	"assistant_turn",
	{
		text: text().notNull(),
		id: text().primaryKey(),
		userId: text().notNull(),
		completedAt: timestamptz(),
		requestId: text().notNull(),
		conversationId: text().notNull(),
		round: integer().notNull().default(0),
		revision: integer().notNull().default(1),
		failure: jsonb().$type<AssistantTurnFailure>(),
		createdAt: timestamptz().notNull().defaultNow(),
		status: text().$type<AssistantTurnStatus>().notNull().default("queued"),
	},
	(t) => [
		foreignKey({
			columns: [t.conversationId, t.userId],
			foreignColumns: [assistantConversation.id, assistantConversation.userId],
		}).onDelete("cascade"),
		unique().on(t.userId, t.requestId),
		unique().on(t.id, t.conversationId, t.userId),
		index("assistant_turn_conversation_created_idx").on(t.conversationId, t.createdAt),
		uniqueIndex("assistant_turn_active_unique")
			.on(t.conversationId)
			.where(sql`${t.status} in ('queued', 'running', 'awaiting-approval')`),
		check(
			"assistant_turn_status",
			sql`${t.status} in ('queued', 'running', 'awaiting-approval', 'completed', 'failed', 'interrupted')`,
		),
	],
);
export const assistantMessage = snakeCase.table(
	"assistant_message",
	{
		id: text().primaryKey(),
		turnId: text().notNull(),
		userId: text().notNull(),
		sequence: integer().notNull(),
		conversationId: text().notNull(),
		createdAt: timestamptz().notNull().defaultNow(),
		role: text().$type<AssistantMessage["role"]>().notNull(),
		parts: jsonb().$type<readonly AssistantMessagePart[]>().notNull(),
	},
	(t) => [
		unique().on(t.conversationId, t.sequence),
		index("assistant_message_turn_sequence_idx").on(t.turnId, t.sequence),
		foreignKey({
			columns: [t.turnId, t.conversationId, t.userId],
			foreignColumns: [assistantTurn.id, assistantTurn.conversationId, assistantTurn.userId],
		}).onDelete("cascade"),
	],
);
export const assistantToolCall = snakeCase.table(
	"assistant_tool_call",
	{
		id: text().primaryKey(),
		turnId: text().notNull(),
		userId: text().notNull(),
		decidedAt: timestamptz(),
		round: integer().notNull(),
		completedAt: timestamptz(),
		position: integer().notNull(),
		conversationId: text().notNull(),
		revision: integer().notNull().default(1),
		result: jsonb().$type<AgentToolResult>(),
		createdAt: timestamptz().notNull().defaultNow(),
		call: jsonb().$type<AssistantToolCall>().notNull(),
		decision: text().$type<AssistantApprovalDecision>(),
	},
	(t) => [
		unique().on(t.turnId, t.round, t.position),
		foreignKey({
			columns: [t.turnId, t.conversationId, t.userId],
			foreignColumns: [assistantTurn.id, assistantTurn.conversationId, assistantTurn.userId],
		}).onDelete("cascade"),
	],
);
export const assistantProvider = snakeCase.table("assistant_provider", {
	model: text().notNull(),
	baseUrl: text().notNull(),
	updatedAt: updatedAtColumn(),
	createdAt: timestamptz().notNull().defaultNow(),
	encryptedApiKey: jsonb().$type<SubkeyCiphertext>(),
	userId: text()
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
});
