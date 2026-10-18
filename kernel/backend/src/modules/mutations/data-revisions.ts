import type { UserCommand } from "@ryot-app/contract/modules/mutations/user-command";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { dataRevision } from "#schema/tables/data-revisions";

export class DataRevisions extends Context.Service<DataRevisions>()("DataRevisions", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const validate = Effect.fn("DataRevisions.validate")(function* (
			input: { pluginId: string; userId: UserId } & NonNullable<UserCommand["dataBaseline"]>,
		) {
			yield* session.requireTransaction.pipe(Effect.orDie);
			const scopes = [
				...(input.globalRevision === undefined
					? []
					: [{ userId: null, expected: input.globalRevision }]),
				...(input.userRevision === undefined
					? []
					: [{ userId: input.userId, expected: input.userRevision }]),
			];
			if (scopes.length === 0) {
				return true;
			}
			yield* session.run((db) =>
				db
					.insert(dataRevision)
					.values(
						scopes.map((scope) => ({
							userId: scope.userId,
							pluginId: input.pluginId,
							id: sql<string>`md5(jsonb_build_array(${input.pluginId}::text, ${scope.userId}::text)::text)`,
						})),
					)
					.onConflictDoNothing(),
			);
			const current = yield* session.run((db) =>
				db
					.select()
					.from(dataRevision)
					.where(
						and(
							eq(dataRevision.pluginId, input.pluginId),
							or(
								...scopes.map((scope) =>
									scope.userId === null
										? isNull(dataRevision.userId)
										: eq(dataRevision.userId, scope.userId),
								),
							),
						),
					)
					.orderBy(dataRevision.id)
					.for("update"),
			);
			return scopes.every((scope) =>
				current.some((row) => row.userId === scope.userId && row.revision === scope.expected),
			);
		});
		return { validate };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
