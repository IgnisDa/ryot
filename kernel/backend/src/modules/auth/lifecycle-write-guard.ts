import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/user-lifecycle";
import { mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";

const checkUserLifecycle = (session: DatabaseSession["Service"]) =>
	Effect.fn("isUserLifecycleActive")(function* (userId: UserId) {
		const database = yield* session.current;
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

export const isUserLifecycleActive = (userId: UserId) =>
	Effect.flatMap(DatabaseSession, (session) => checkUserLifecycle(session)(userId));

export class LifecycleWriteGuard extends Context.Service<LifecycleWriteGuard>()(
	"LifecycleWriteGuard",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			return { isActive: checkUserLifecycle(session) };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
