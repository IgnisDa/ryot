import { UserId } from "@ryot-app/contract/schema/brands";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { Cause, Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/auth";
import { DatabaseSession } from "#lib/infrastructure/db/session";

import { LifecycleWriteGuard } from "./lifecycle-write-guard";

export class SessionCreationGate extends Context.Service<SessionCreationGate>()(
	"SessionCreationGate",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const lifecycle = yield* LifecycleWriteGuard;
			const gate = <E>(userId: string, runBootstrap: (userId: string) => Effect.Effect<void, E>) =>
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
							Effect.catchCauseIf(
								(cause) => !Cause.hasInterruptsOnly(cause),
								(cause) =>
									Effect.logError("user bootstrap failed during session creation", cause).pipe(
										Effect.annotateLogs({ userId }),
										Effect.andThen(
											Effect.fail(
												APIError.from("SERVICE_UNAVAILABLE", {
													code: "USER_INITIALIZING",
													message: "Account initialization in progress. Please sign in again.",
												}),
											),
										),
									),
							),
							Effect.mapError(() =>
								APIError.from("SERVICE_UNAVAILABLE", {
									code: "USER_INITIALIZING",
									message: "Account initialization in progress. Please sign in again.",
								}),
							),
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
