import type { UserId } from "@ryot/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

export type TrackerStateRow = typeof schema.trackerState.$inferSelect;

export class TrackersRepository extends Effect.Service<TrackersRepository>()("TrackersRepository", {
	sync: () => {
		const listStates = Effect.fn(function* (userId: UserId) {
			const db = yield* CurrentDb;
			return yield* dbEffect(() =>
				db.select().from(schema.trackerState).where(eq(schema.trackerState.userId, userId)),
			);
		});
		const upsertState = Effect.fn(function* (input: {
			userId: UserId;
			trackerSlug: string;
			config: Record<string, unknown>;
			sortOrder: number;
			isDisabled: boolean;
		}) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.insert(schema.trackerState)
					.values(input)
					.onConflictDoUpdate({
						target: [schema.trackerState.userId, schema.trackerState.trackerSlug],
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
		const getState = Effect.fn(function* (userId: UserId, trackerSlug: string) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select()
					.from(schema.trackerState)
					.where(
						and(
							eq(schema.trackerState.userId, userId),
							eq(schema.trackerState.trackerSlug, trackerSlug),
						),
					)
					.limit(1),
			);
			return row ?? null;
		});
		return { getState, listStates, upsertState };
	},
}) {}
