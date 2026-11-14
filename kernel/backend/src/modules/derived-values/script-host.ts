import { FoldRequest } from "@ryot-app/contract/modules/events/folds";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
	type ScriptRunInput,
} from "#modules/scripts/authorization/capabilities";
import { sandboxRunUserId } from "#modules/scripts/host/execution-context";
import { DatabaseSession } from "#platform/db/session";

import { FoldMarks, foldValuesSql } from "./marks";

export const makeFoldScriptHost = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	const marks = yield* FoldMarks.make;
	const request = (
		rawInput: ScriptRunInput,
		capability: "requestFolds" | "requestFoldsForAllUsers",
		body: unknown,
	) =>
		sandboxHostEffect(
			Effect.gen(function* () {
				const input = yield* requireSandboxCapabilityInput(rawInput, capability);
				const pin = input.principal.pluginRevision;
				if (!pin) {
					return yield* Effect.fail(`${capability} requires a pinned plugin script`);
				}
				const { entityIds } = yield* Schema.decodeUnknownEffect(FoldRequest)(body);
				const caller = sandboxRunUserId(input);
				if (capability === "requestFolds" && caller === null) {
					return yield* Effect.fail("requestFolds requires a user execution");
				}
				const queued = yield* session
					.transaction(
						Effect.gen(function* () {
							const users =
								capability === "requestFolds" && caller !== null
									? [caller]
									: (yield* session.run((db) =>
											db.execute<{ userId: string }>(
												sql`select distinct user_id as "userId" from event
												where entity_id in (${foldValuesSql(entityIds)})
													or session_entity_id in (${foldValuesSql(entityIds)})`,
												"objects",
											),
										)).map((row) => row.userId);
							const resolved = yield* marks.resolve({
								sources: [],
								subjects: users.flatMap((userId) =>
									entityIds.map((entityId) => ({
										userId: UserId.make(userId),
										entityId: EntityId.make(entityId),
									})),
								),
							});
							return yield* marks.queueResolved(
								resolved.filter(({ declaration }) => declaration.pluginId === pin.id),
							);
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
				return { queued };
			}),
		);
	return {
		requestFolds: (rawInput, body) => request(rawInput, "requestFolds", body),
		requestFoldsForAllUsers: (rawInput, body) => request(rawInput, "requestFoldsForAllUsers", body),
	} satisfies Pick<
		AdditionalScriptHostImplementationMap,
		"requestFolds" | "requestFoldsForAllUsers"
	>;
});
