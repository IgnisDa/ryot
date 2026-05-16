import { badRequest, internalError, notFound } from "@ryot/contract/errors";
import type { UserLifecycleOperationKind } from "@ryot/contract/modules/god-mode/user-lifecycle";
import type { UserId } from "@ryot/contract/schema/brands";
import { Context, DateTime, Effect, Layer, Result } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { AuthService } from "#modules/auth/service";

import { classifyAuthState } from "./auth-state";
import { UserLifecycleRepository } from "./repository";
import { UserLifecycleWorkflow } from "./workflow";

const ACCESS_REVOCATION_CLAIM_TIMEOUT_MS = 60_000;

const accessRevocationStaleBefore = (now: Date) =>
	new Date(now.getTime() - ACCESS_REVOCATION_CLAIM_TIMEOUT_MS);

const executionIdFor = (operationId: string, workflowAttempt: number) =>
	`user-lifecycle-${operationId}-${workflowAttempt}`;

export class UserLifecycleService extends Context.Service<UserLifecycleService>()(
	"UserLifecycleService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			const config = yield* AppConfig;
			const database = yield* Database;
			const engine = yield* WorkflowEngine;
			const repository = yield* UserLifecycleRepository;

			const ensureAccessRevoked = Effect.fn("UserLifecycleService.ensureAccessRevoked")(function* (
				operationId: string,
			) {
				const current = yield* repository.getInternalById(operationId);
				if (!current) {
					return yield* internalError("User lifecycle operation was not found");
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
					return yield* internalError("User lifecycle access revocation is already in progress");
				}

				return yield* Effect.gen(function* () {
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
					yield* auth.purgeApiKeyCaches(claimed.operation.userId, claimed.metadata.apiKeys);
					return (
						(yield* repository.markAccessRevoked(operationId)) ??
						(yield* internalError("User lifecycle access revocation could not be recorded"))
					);
				}).pipe(
					Effect.catchCause((cause) =>
						repository
							.releaseAccessRevocation(operationId)
							.pipe(
								Effect.ignoreCause,
								Effect.andThen(
									Effect.logError("user lifecycle access revocation failed", cause).pipe(
										Effect.annotateLogs({ operationId }),
									),
								),
								Effect.andThen(internalError("User lifecycle access revocation failed")),
							),
					),
				);
			});

			const dispatch = Effect.fn("UserLifecycleService.dispatch")(function* (operation: {
				workflowAttempt: number;
				operation: { id: string };
			}) {
				const dispatched = yield* engine
					.execute(UserLifecycleWorkflow, {
						discard: true,
						executionId: executionIdFor(operation.operation.id, operation.workflowAttempt),
						payload: { operationId: operation.operation.id },
					})
					.pipe(Effect.result);
				if (Result.isFailure(dispatched)) {
					yield* Effect.logError("user lifecycle workflow enqueue failed", dispatched.failure).pipe(
						Effect.annotateLogs({ operationId: operation.operation.id }),
					);
					return yield* internalError("User lifecycle workflow could not be queued");
				}
				return undefined;
			});

			const request = Effect.fn("UserLifecycleService.request")(function* (
				userId: UserId,
				kind: UserLifecycleOperationKind,
			) {
				const prepared = yield* mapDatabaseErrors(
					database.transaction(
						(transaction) =>
							Effect.gen(function* () {
								const preparation = yield* repository.loadPreparationForUpdate(userId, kind);
								if (!preparation) {
									return yield* notFound(`User with id '${userId}' not found`);
								}
								if (preparation.active) {
									return preparation.active;
								}
								if (preparation.retryable) {
									return (
										(yield* repository.reactivateFailed(preparation.retryable.operation.id)) ??
										(yield* internalError("Failed user lifecycle operation could not be retried"))
									);
								}

								const authState = classifyAuthState(preparation.metadata.accounts);
								if (kind === "reset" && authState === "mixed") {
									return yield* badRequest(
										"Cannot reset a user with mixed authentication (both credential and OIDC accounts).",
									);
								}
								const usesLocalAuth = authState === "credential" || authState === "none";
								if (kind === "reset" && usesLocalAuth && config.users.disableLocalAuth) {
									return yield* badRequest("Local authentication is disabled on this instance");
								}

								return yield* repository.create({
									kind,
									userId,
									id: crypto.randomUUID(),
									metadata: {
										...preparation.metadata,
										usesLocalAuth,
										recreatedAccountId: crypto.randomUUID(),
									},
								});
							}).pipe(Effect.provideService(Database, transaction)),
						{ isolationLevel: "read committed" },
					),
				);

				const ready = yield* ensureAccessRevoked(prepared.operation.id);
				yield* dispatch(ready);
				return (yield* repository.getById(prepared.operation.id)) ?? prepared.operation;
			});

			const reconcilePending = Effect.fn("UserLifecycleService.reconcilePending")(function* (
				limit: number,
			) {
				const pending = yield* repository.listPending(limit);
				yield* Effect.forEach(
					pending,
					(operation) =>
						ensureAccessRevoked(operation.operation.id).pipe(
							Effect.flatMap(dispatch),
							Effect.catchCause((cause) =>
								Effect.logError("pending user lifecycle reconciliation failed", cause).pipe(
									Effect.annotateLogs({ operationId: operation.operation.id }),
								),
							),
						),
					{ discard: true },
				);
			});

			const getOperation = Effect.fn("UserLifecycleService.getOperation")(function* (
				operationId: string,
			) {
				return (
					(yield* repository.getById(operationId)) ??
					(yield* notFound(`User lifecycle operation '${operationId}' was not found`))
				);
			});

			return {
				getOperation,
				reconcilePending,
				resetUser: (userId: UserId) => request(userId, "reset"),
				deleteUser: (userId: UserId) => request(userId, "delete"),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
