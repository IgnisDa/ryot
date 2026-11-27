import type { UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { WorkflowReplayJournalEntry } from "@ryot-app/plugin-backend-sdk/workflow/protocol";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { agentScriptExecution as table } from "#schema/tables/agent-scripts";

import type { ScriptExecutionPrincipal } from "../authorization/principal";

const owned = (userId: UserId, id: string) => and(eq(table.id, id), eq(table.userId, userId));

export class AgentScriptRepository extends Context.Service<AgentScriptRepository>()(
	"@ryot-app/kernel-backend/modules/scripts/agent/repository/AgentScriptRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const find = Effect.fn("AgentScriptRepository.find")(function* (userId: UserId, id: string) {
				const [row] = yield* session.run((db) =>
					db.select().from(table).where(owned(userId, id)).limit(1),
				);
				return row ?? null;
			});
			const create = Effect.fn("AgentScriptRepository.create")(function* (input: {
				id: string;
				userId: UserId;
				source: string;
			}) {
				const rows = yield* session.run((db) =>
					db.insert(table).values(input).onConflictDoNothing().returning({ id: table.id }),
				);
				return rows.length === 1;
			});
			const pin = (userId: UserId, id: string, principal: ScriptExecutionPrincipal) =>
				session.run((db) =>
					db
						.update(table)
						.set({ principal })
						.where(and(owned(userId, id), isNull(table.principal))),
				);
			const appendJournal = Effect.fn("AgentScriptRepository.appendJournal")(function* (
				userId: UserId,
				id: string,
				expectedLength: number,
				journal: readonly WorkflowReplayJournalEntry[],
			) {
				const rows = yield* session.run((db) =>
					db
						.update(table)
						.set({ journal })
						.where(
							and(
								owned(userId, id),
								isNull(table.completedAt),
								sql`jsonb_array_length(${table.journal}) = ${expectedLength}`,
							),
						)
						.returning({ id: table.id }),
				);
				return rows.length === 1;
			});
			const complete = (userId: UserId, id: string, result: JsonValue) =>
				session.run((db) =>
					db
						.update(table)
						.set({ result, completedAt: sql`now()` })
						.where(and(owned(userId, id), isNull(table.completedAt))),
				);
			return { pin, find, create, complete, appendJournal };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
