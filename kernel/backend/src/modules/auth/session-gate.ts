import { UserId } from "@ryot-app/contract/schema/brands";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/auth";
import { DatabaseSession } from "#lib/infrastructure/db/session";

import { LifecycleWriteGuard } from "./lifecycle-write-guard";

export class SessionCreationGate extends Context.Service<SessionCreationGate>()(
	"SessionCreationGate",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const lifecycle = yield* LifecycleWriteGuard;
			const gate = (userId: string) =>
				Effect.gen(function* () {
					if (yield* lifecycle.isActive(UserId.make(userId))) {
						return yield* Effect.fail(
							APIError.from("FORBIDDEN", {
								code: "USER_LIFECYCLE_ACTIVE",
								message: "This user is temporarily unavailable.",
							}),
						);
					}
					const [foundUser] = yield* database.run((db) =>
						db
							.select({ disabledAt: schema.user.disabledAt })
							.from(schema.user)
							.where(eq(schema.user.id, userId))
							.limit(1),
					);

					if (foundUser?.disabledAt) {
						return yield* Effect.fail(
							APIError.from("FORBIDDEN", {
								code: "USER_DISABLED",
								message: "This user has been disabled.",
							}),
						);
					}
					return undefined;
				});
			return { gate };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
