import type { UserId } from "@ryot/contract/schema/brands";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/user-lifecycle";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export const isUserLifecycleActive = Effect.fn("isUserLifecycleActive")(function* (userId: UserId) {
	const database = yield* Database;
	const [row] = yield* mapDatabaseErrors(
		database
			.select({ id: schema.userLifecycleOperation.id })
			.from(schema.userLifecycleOperation)
			.where(
				and(
					eq(schema.userLifecycleOperation.userId, userId),
					inArray(schema.userLifecycleOperation.status, ["pending", "running"]),
				),
			)
			.limit(1),
	);
	return row !== undefined;
});

export class LifecycleWriteGuard extends Context.Service<LifecycleWriteGuard>()(
	"LifecycleWriteGuard",
	{
		make: Effect.gen(function* () {
			const database = yield* Database;
			return {
				isActive: (userId: UserId) =>
					isUserLifecycleActive(userId).pipe(Effect.provideService(Database, database)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
