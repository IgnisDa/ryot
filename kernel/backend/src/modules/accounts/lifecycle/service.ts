import type { UserLifecycleOperationKind } from "@ryot-app/contract/modules/instance-admin/user-lifecycle";
import type { UserId } from "@ryot-app/contract/schema/brands";
import {
	InstanceAdminInternalFailure,
	InstanceAdminNotFound,
	InstanceAdminRequestFailure,
} from "@ryot-app/instance-contract/account-admin";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import { AuthService } from "#modules/accounts/auth/service";
import { AppConfig } from "#platform/config/service";
import { mapDatabaseErrors } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue, makeJobKind } from "#platform/jobs/queue";

import { classifyAuthState } from "./auth-state";
import { UserLifecycleRepository } from "./repository";

export const UserLifecycleJob = makeJobKind("user-lifecycle", {
	concurrency: 2,
	payload: Schema.Struct({ operationId: Schema.String }),
});

type Preparation = NonNullable<
	Effect.Success<ReturnType<UserLifecycleRepository["Service"]["loadPreparationForUpdate"]>>
>;

export class UserLifecycleService extends Context.Service<UserLifecycleService>()(
	"@ryot-app/kernel-backend/modules/accounts/lifecycle/service/UserLifecycleService",
	{
		make: Effect.gen(function* () {
			const random = yield* SecureRandom.SecureRandom;
			const auth = yield* AuthService;
			const config = yield* AppConfig;
			const database = yield* DatabaseSession;
			const jobs = yield* JobQueue;
			const repository = yield* UserLifecycleRepository;

			const revokeAccess = Effect.fnUntraced(function* (userId: UserId, disabledAt: null | string) {
				const updatedAt = yield* DateTime.nowAsDate;
				yield* auth.updateAuthUserDisabled(userId, {
					updatedAt,
					disabledAt:
						disabledAt === null ? updatedAt : DateTime.toDate(DateTime.makeUnsafe(disabledAt)),
				});
				yield* auth.deleteUserSessions(userId);
				yield* auth.revokeUserOAuthTokens(userId);
				yield* auth.revokePasswordResetLinks(userId);
			});

			const open = Effect.fnUntraced(function* (
				userId: UserId,
				kind: UserLifecycleOperationKind,
				preparation: Preparation,
			) {
				if (preparation.retryable) {
					return (
						(yield* repository.reactivateFailed(preparation.retryable.operation.id)) ??
						(yield* new InstanceAdminInternalFailure({
							reason: { code: "lifecycle-state-conflict" },
						}))
					);
				}

				const authState = classifyAuthState(preparation.metadata.accounts);
				if (kind === "reset" && authState === "mixed") {
					return yield* new InstanceAdminRequestFailure({
						reason: { code: "mixed-auth-reset-unsupported" },
					});
				}
				const usesLocalAuth = authState === "credential" || authState === "none";
				if (kind === "reset" && usesLocalAuth && config.users.disableLocalAuth) {
					return yield* new InstanceAdminRequestFailure({
						reason: { code: "local-auth-disabled" },
					});
				}

				return yield* repository.create({
					kind,
					userId,
					id: yield* random.uuidV4(),
					metadata: {
						...preparation.metadata,
						usesLocalAuth,
						recreatedAccountId: yield* random.uuidV4(),
					},
				});
			});

			const request = Effect.fn("UserLifecycleService.request")(function* (
				userId: UserId,
				kind: UserLifecycleOperationKind,
			) {
				const requested = yield* mapDatabaseErrors(
					database
						.transaction(
							Effect.gen(function* () {
								const preparation = yield* repository.loadPreparationForUpdate(userId, kind);
								if (!preparation) {
									return yield* new InstanceAdminNotFound({
										reason: { userId, code: "user-not-found" },
									});
								}
								if (preparation.active) {
									return preparation.active;
								}
								const opened = yield* open(userId, kind, preparation);
								yield* revokeAccess(userId, preparation.metadata.user.disabledAt);
								return opened;
							}).pipe(
								Effect.tap(({ operation }) =>
									jobs.enqueue(
										UserLifecycleJob,
										{ operationId: operation.id },
										{ key: operation.id },
									),
								),
							),
						)
						.pipe(
							Effect.catchTags({
								SchemaError: Effect.die,
								DatabaseSessionStateError: () =>
									new InstanceAdminInternalFailure({
										reason: { code: "lifecycle-state-conflict" },
									}),
							}),
						),
				);
				return { operationId: requested.operation.id };
			});

			return {
				resetUser: (userId: UserId) => request(userId, "reset"),
				deleteUser: (userId: UserId) => request(userId, "delete"),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
