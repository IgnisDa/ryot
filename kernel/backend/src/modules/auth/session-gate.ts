import { UserId } from "@ryot/contract/schema/brands";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/auth";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import { isUserLifecycleActive } from "./lifecycle-write-guard";

export const gateSessionCreation = (
	userId: string,
	runBootstrap: (userId: string) => Effect.Effect<void, unknown>,
) =>
	Effect.gen(function* () {
		if (yield* isUserLifecycleActive(UserId.make(userId))) {
			return yield* Effect.fail(
				APIError.from("FORBIDDEN", {
					code: "USER_LIFECYCLE_ACTIVE",
					message: "This user is temporarily unavailable.",
				}),
			);
		}
		const db = yield* Database;
		const [foundUser] = yield* mapDatabaseErrors(
			db
				.select({
					disabledAt: schema.user.disabledAt,
					bootstrapCompletedAt: schema.user.bootstrapCompletedAt,
				})
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
		if (foundUser && !foundUser.bootstrapCompletedAt) {
			yield* runBootstrap(userId).pipe(
				Effect.catchCause(() =>
					Effect.fail(
						APIError.from("SERVICE_UNAVAILABLE", {
							code: "USER_INITIALIZING",
							message: "Account initialization in progress. Please sign in again.",
						}),
					),
				),
			);
		}
		return undefined;
	});
