import {
	InstanceAdminInternalFailure,
	InstanceAdminNotFound,
	InstanceAdminRequestFailure,
} from "@ryot-app/contract/modules/instance-admin/contract";
import type { UserLifecycleOperationKind } from "@ryot-app/contract/modules/instance-admin/user-lifecycle";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, DateTime, Effect, Layer, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import { AuthService } from "#modules/accounts/auth/service";
import { AppConfig } from "#platform/config/service";
import { mapDatabaseErrors } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue, makeJobKind } from "#platform/jobs/queue";

import { classifyAuthState } from "./auth-state";
import { UserLifecycleRepository } from "./repository";

const ACCESS_REVOCATION_CLAIM_TIMEOUT_MS = 60_000;

const accessRevocationStaleBefore = (now: Date) =>
	new Date(now.getTime() - ACCESS_REVOCATION_CLAIM_TIMEOUT_MS);

export const UserLifecycleJob = makeJobKind("user-lifecycle", {
	concurrency: 2,
	payload: Schema.Struct({ operationId: Schema.String }),
});

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
			const revokeClaimedAccess = Effect.fnUntraced(function* (
				operationId: string,
				claimed: NonNullable<Effect.Success<ReturnType<typeof repository.claimAccessRevocation>>>,
			) {
				if (yield* repository.userExists(claimed.operation.userId)) {
					const disabledAt = claimed.metadata.user.disabledAt
						? DateTime.toDate(DateTime.makeUnsafe(claimed.metadata.user.disabledAt))
						: yield* DateTime.nowAsDate;
					yield* auth.updateAuthUserDisabled(claimed.operation.userId, {
						disabledAt,
						updatedAt: yield* DateTime.nowAsDate,
					});
				}
				yield* auth.deleteUserSessions(claimed.operation.userId);
				yield* auth.revokeUserOAuthTokens(claimed.operation.userId);
				yield* auth.purgeApiKeyCaches(claimed.operation.userId, claimed.metadata.apiKeys);
				yield* auth.revokePasswordResetLinks(claimed.operation.userId);
				return (
					(yield* repository.markAccessRevoked(operationId)) ??
					(yield* new InstanceAdminInternalFailure({
						reason: { code: "access-revocation-failed" },
					}))
				);
			});

			const ensureAccessRevoked = Effect.fn("UserLifecycleService.ensureAccessRevoked")(function* (
				operationId: string,
			) {
				const current = yield* repository.getInternalById(operationId);
				if (!current) {
					return yield* new InstanceAdminInternalFailure({
						reason: { code: "lifecycle-state-conflict" },
					});
				}
				if (current.accessRevokedAt !== null) {
					return current;
				}

				const now = yield* DateTime.nowAsDate;
				const claimed = yield* repository.claimAccessRevocation(
					operationId,
					accessRevocationStaleBefore(now),
				);
				if (!claimed) {
					const refreshed = yield* repository.getInternalById(operationId);
					if (refreshed?.accessRevokedAt) {
						return refreshed;
					}
					return yield* new InstanceAdminInternalFailure({
						reason: { code: "lifecycle-state-conflict" },
					});
				}

				return yield* revokeClaimedAccess(operationId, claimed).pipe(
					Effect.catchCause((cause) =>
						repository
							.releaseAccessRevocation(operationId)
							.pipe(
								Effect.ignoreCause,
								Effect.andThen(
									Cause.hasInterruptsOnly(cause)
										? Effect.failCause(cause)
										: Effect.logError("user lifecycle access revocation failed", cause).pipe(
												Effect.annotateLogs({ operationId }),
												Effect.andThen(
													new InstanceAdminInternalFailure({
														reason: { code: "access-revocation-failed" },
													}),
												),
											),
								),
							),
					),
					Effect.mapError(
						() =>
							new InstanceAdminInternalFailure({ reason: { code: "access-revocation-failed" } }),
					),
				);
			});

			const request = Effect.fn("UserLifecycleService.request")(function* (
				userId: UserId,
				kind: UserLifecycleOperationKind,
			) {
				const prepared = yield* mapDatabaseErrors(
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
							}).pipe(
								Effect.tap((operation) =>
									jobs.enqueue(
										UserLifecycleJob,
										{ operationId: operation.operation.id },
										{ key: operation.operation.id },
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

				yield* ensureAccessRevoked(prepared.operation.id);
				return { operationId: prepared.operation.id };
			});

			return {
				ensureAccessRevoked,
				resetUser: (userId: UserId) => request(userId, "reset"),
				deleteUser: (userId: UserId) => request(userId, "delete"),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
