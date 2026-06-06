import type { UserId } from "@ryot/contract/schema/brands";
import { and, asc, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export type PluginStateRow = typeof schema.pluginState.$inferSelect;

type RestorePluginStateInput = Omit<PluginStateRow, "userId"> & { readonly userId: UserId };

export class DefinitionsRepository extends Context.Service<DefinitionsRepository>()(
	"DefinitionsRepository",
	{
		make: Effect.sync(() => {
			const listPluginStates = Effect.fn(function* (userId: UserId) {
				const db = yield* Database;
				return yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.pluginState)
						.where(eq(schema.pluginState.userId, userId))
						.orderBy(asc(schema.pluginState.id)),
				);
			});
			const restorePluginState = Effect.fn("DefinitionsRepository.restorePluginState")(function* (
				input: RestorePluginStateInput,
			) {
				const db = yield* Database;
				yield* mapDatabaseErrors(db.insert(schema.pluginState).values(input));
			});
			const upsertPluginState = Effect.fn(function* (input: {
				userId: UserId;
				sortOrder: number;
				pluginSlug: string;
				isDisabled: boolean;
				config: Record<string, unknown>;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.pluginState)
						.values(input)
						.onConflictDoUpdate({
							target: [schema.pluginState.userId, schema.pluginState.pluginSlug],
							set: {
								config: input.config,
								sortOrder: input.sortOrder,
								isDisabled: input.isDisabled,
							},
						})
						.returning(),
				);
				return row;
			});
			const getPluginState = Effect.fn(function* (userId: UserId, pluginSlug: string) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.pluginState)
						.where(
							and(
								eq(schema.pluginState.userId, userId),
								eq(schema.pluginState.pluginSlug, pluginSlug),
							),
						)
						.limit(1),
				);
				return row ?? null;
			});
			return { getPluginState, listPluginStates, restorePluginState, upsertPluginState };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
