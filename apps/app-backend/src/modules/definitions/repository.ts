import type { UserId } from "@ryot/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

export type PluginStateRow = typeof schema.pluginState.$inferSelect;

export class DefinitionsRepository extends Effect.Service<DefinitionsRepository>()(
	"DefinitionsRepository",
	{
		sync: () => {
			const listPluginStates = Effect.fn(function* (userId: UserId) {
				const db = yield* CurrentDb;
				return yield* dbEffect(() =>
					db.select().from(schema.pluginState).where(eq(schema.pluginState.userId, userId)),
				);
			});
			const upsertPluginState = Effect.fn(function* (input: {
				userId: UserId;
				sortOrder: number;
				pluginSlug: string;
				isDisabled: boolean;
				config: Record<string, unknown>;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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
			return { getPluginState, listPluginStates, upsertPluginState };
		},
	},
) {}
