import type { JsonValue } from "@ryot-app/contract/schema/json";
import { boolean, jsonb, snakeCase, text } from "drizzle-orm/pg-core";

import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";

import { user } from "./auth";
import { timestamptz } from "./timestamps";

export const agentScriptExecution = snakeCase.table("agent_script_execution", {
	id: text().primaryKey(),
	source: text().notNull(),
	completedAt: timestamptz(),
	allowWrites: boolean().notNull(),
	result: jsonb().$type<JsonValue>(),
	createdAt: timestamptz().notNull().defaultNow(),
	principal: jsonb().$type<ScriptExecutionPrincipal>(),
	userId: text()
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});
