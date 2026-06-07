import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { user } from "#lib/db/schema/tables/auth";
import { CurrentDb, dbEffect } from "#lib/db/service";
import type { UserId } from "#lib/schema/brands";

export class UserPreferencesRepository extends Effect.Service<UserPreferencesRepository>()(
	"UserPreferencesRepository",
	{
		sync: () => {
			const findByUserId = Effect.fn("UserPreferencesRepository.findByUserId")(function* (
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ preferences: user.preferences })
						.from(user)
						.where(eq(user.id, userId))
						.limit(1),
				);

				return row?.preferences ?? null;
			});

			const updateForUser = Effect.fn("UserPreferencesRepository.updateForUser")(function* (input: {
				userId: UserId;
				preferences: Record<string, unknown>;
			}) {
				const db = yield* CurrentDb;
				yield* dbEffect(() =>
					db.update(user).set({ preferences: input.preferences }).where(eq(user.id, input.userId)),
				);
			});

			return { findByUserId, updateForUser };
		},
	},
) {}
