import { createOAuthAccountIssuer } from "@better-auth/core/db";
import { defaultUserPreferences } from "@ryot-app/contract/auth-middleware";
import { InternalError, internalError } from "@ryot-app/contract/errors";
import {
	type UserLifecycleOperationFailure,
	type UserLifecycleOperationKind,
	UserResetResult,
} from "@ryot-app/contract/modules/god-mode/user-lifecycle";
import { Cause, Context, DateTime, Effect, Layer, Result, Schema } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";

import { Database } from "#lib/infrastructure/db/service";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { AuthService } from "#modules/auth/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { PluginInstallationService } from "#modules/plugins/installation-service";
import { SavedViewsService } from "#modules/saved-views/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";
import { performBootstrap } from "#modules/user-bootstrap/bootstrap";
import { PluginUserBootstrapDispatcher } from "#modules/user-bootstrap/plugin-dispatch";

import { UserLifecycleRepository } from "./repository";

const UserLifecycleWorkflowPayload = Schema.Struct({ operationId: Schema.String });
type UserLifecycleWorkflowPayload = typeof UserLifecycleWorkflowPayload.Type;

const WorkflowOperationKind = Schema.NullOr(Schema.Literals(["delete", "reset"]));

export const UserLifecycleWorkflow = Workflow.make("UserLifecycleWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: InternalError satisfies DurableSchema,
	idempotencyKey: ({ operationId }) => operationId,
	payload: UserLifecycleWorkflowPayload satisfies DurableSchema,
});

type UserLifecycleWorkflowOperationsValue = {
	begin: (operationId: string) => Effect.Effect<UserLifecycleOperationKind | null, InternalError>;
	cleanupObjects: (operationId: string) => Effect.Effect<void, InternalError>;
	deleteDatabaseUser: (operationId: string) => Effect.Effect<void, InternalError>;
	recreateResetUser: (operationId: string) => Effect.Effect<UserResetResult, InternalError>;
	complete: (
		operationId: string,
		result: UserResetResult | null,
	) => Effect.Effect<void, InternalError>;
	fail: (
		operationId: string,
		failure: UserLifecycleOperationFailure,
	) => Effect.Effect<void, InternalError>;
};

export class UserLifecycleWorkflowOperations extends Context.Service<
	UserLifecycleWorkflowOperations,
	UserLifecycleWorkflowOperationsValue
>()("UserLifecycleWorkflowOperations") {}

const asInternal = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
	effect.pipe(
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) => Effect.logError(message, cause).pipe(Effect.andThen(internalError(message))),
		),
		Effect.mapError(() => internalError(message)),
	);

export const UserLifecycleWorkflowOperationsLive = Layer.effect(
	UserLifecycleWorkflowOperations,
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const database = yield* Database;
		const savedViews = yield* SavedViewsService;
		const repository = yield* UserLifecycleRepository;
		const objectStorage = yield* ObjectStorageService;
		const pluginBootstrap = yield* PluginUserBootstrapDispatcher;
		const pluginInstallations = yield* PluginInstallationService;
		const notificationSubscriptions = yield* NotificationSubscriptionsService;

		const requireOperation = (operationId: string) =>
			repository.getInternalById(operationId).pipe(
				Effect.filterOrElse(
					(operation): operation is NonNullable<typeof operation> => operation !== null,
					() => internalError("User lifecycle operation was not found"),
				),
			);

		const begin = (operationId: string) =>
			asInternal(
				Effect.gen(function* () {
					const operation = yield* repository.markRunning(operationId);
					if (
						!operation ||
						operation.operation.status === "completed" ||
						operation.operation.status === "failed"
					) {
						return null;
					}
					return operation.operation.kind;
				}),
				"User lifecycle operation could not start",
			);

		const cleanupObjects = (operationId: string) =>
			asInternal(
				Effect.gen(function* () {
					const operation = yield* requireOperation(operationId);
					yield* Effect.forEach(operation.metadata.locators, objectStorage.deleteObject, {
						discard: true,
						concurrency: 1,
					});
				}),
				"User-owned object cleanup failed",
			);

		const deleteDatabaseUser = (operationId: string) =>
			asInternal(
				Effect.gen(function* () {
					const operation = yield* requireOperation(operationId);
					if (operation.databaseCleanupCompletedAt !== null) {
						return;
					}
					if (yield* repository.userExists(operation.operation.userId)) {
						yield* auth.deleteAuthUser(operation.operation.userId);
					}
					yield* repository.markDatabaseCleanupCompleted(operationId);
				}),
				"User database cleanup failed",
			);

		const recreateResetUser = (operationId: string) =>
			asInternal(
				Effect.gen(function* () {
					const operation = yield* requireOperation(operationId);
					if (
						operation.operation.kind !== "reset" ||
						operation.databaseCleanupCompletedAt === null
					) {
						return yield* internalError("Reset recreation started before database cleanup");
					}
					const { metadata } = operation;
					const disabledAt = yield* DateTime.nowAsDate;
					let identity = yield* repository.loadRecreatedIdentity(operation.operation.userId);
					if (!identity) {
						yield* auth.createAuthUser({
							disabledAt,
							name: metadata.user.name,
							email: metadata.user.email,
							id: operation.operation.userId,
							preferences: defaultUserPreferences,
							emailVerified: metadata.user.emailVerified,
						});
						identity = yield* repository.loadRecreatedIdentity(operation.operation.userId);
					}
					yield* auth.updateAuthUserDisabled(operation.operation.userId, {
						disabledAt,
						updatedAt: yield* DateTime.nowAsDate,
					});
					if (
						!identity ||
						identity.user.email.toLowerCase() !== metadata.user.email.toLowerCase()
					) {
						return yield* internalError("Reset user identity could not be recreated");
					}

					const oidc = metadata.accounts.find((account) => account.providerId === "oidc");
					if (
						oidc &&
						!identity.accounts.some(
							(account) => account.providerId === "oidc" && account.accountId === oidc.accountId,
						)
					) {
						yield* auth.linkAuthAccount({
							providerId: "oidc",
							accountId: oidc.accountId,
							id: metadata.recreatedAccountId,
							userId: operation.operation.userId,
							issuer: createOAuthAccountIssuer("oidc"),
						});
					}

					yield* performBootstrap(operation.operation.userId).pipe(
						Effect.provideService(PluginInstallationService, pluginInstallations),
						Effect.provideService(PluginUserBootstrapDispatcher, pluginBootstrap),
						Effect.provideService(NotificationSubscriptionsService, notificationSubscriptions),
						Effect.provideService(SavedViewsService, savedViews),
					);
					const resetUrl = metadata.usesLocalAuth
						? (yield* auth.requestPasswordResetLink(metadata.user.email)).resetUrl
						: null;
					return { resetUrl, email: metadata.user.email, userId: operation.operation.userId };
				}),
				"Reset user recreation failed",
			);

		const complete = (operationId: string, result: UserResetResult | null) =>
			asInternal(
				database.transaction((transaction) =>
					repository
						.markCompleted(operationId, result)
						.pipe(Effect.provideService(Database, transaction)),
				),
				"User lifecycle completion could not be recorded",
			);
		const fail = (operationId: string, failure: UserLifecycleOperationFailure) =>
			asInternal(
				repository.markFailed(operationId, failure),
				"User lifecycle failure could not be recorded",
			);
		const provideDatabase = <A, E>(effect: Effect.Effect<A, E, Database>) =>
			effect.pipe(Effect.provideService(Database, database));

		return {
			begin: (operationId) => provideDatabase(begin(operationId)),
			fail: (operationId, failure) => provideDatabase(fail(operationId, failure)),
			cleanupObjects: (operationId) => provideDatabase(cleanupObjects(operationId)),
			complete: (operationId, result) => provideDatabase(complete(operationId, result)),
			recreateResetUser: (operationId) => provideDatabase(recreateResetUser(operationId)),
			deleteDatabaseUser: (operationId) => provideDatabase(deleteDatabaseUser(operationId)),
		} satisfies UserLifecycleWorkflowOperationsValue;
	}),
);

export const runUserLifecycleWorkflow = Effect.fn("UserLifecycleWorkflow")(
	function* (payload: UserLifecycleWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId, operationId: payload.operationId });
		const operations = yield* UserLifecycleWorkflowOperations;
		const started = yield* Activity.make({
			name: "begin-user-lifecycle",
			error: InternalError satisfies DurableSchema,
			execute: operations.begin(payload.operationId),
			success: WorkflowOperationKind satisfies DurableSchema,
		}).pipe(Activity.retry({ times: 3 }), Effect.result);
		if (Result.isFailure(started)) {
			yield* Activity.make({
				name: "fail-unstarted-user-lifecycle",
				error: InternalError satisfies DurableSchema,
				success: Schema.Void satisfies DurableSchema,
				execute: operations.fail(payload.operationId, { code: "operation-start-failed" }),
			}).pipe(Activity.retry({ times: 3 }));
			return;
		}
		if (started.success === null) {
			return;
		}

		const cleaned = yield* Activity.make({
			name: "cleanup-user-lifecycle-objects",
			error: InternalError satisfies DurableSchema,
			success: Schema.Void satisfies DurableSchema,
			execute: operations.cleanupObjects(payload.operationId),
		}).pipe(Activity.retry({ times: 5 }), Effect.result);
		if (Result.isFailure(cleaned)) {
			yield* Activity.make({
				name: "fail-user-lifecycle-object-cleanup",
				error: InternalError satisfies DurableSchema,
				success: Schema.Void satisfies DurableSchema,
				execute: operations.fail(payload.operationId, { code: "object-cleanup-failed" }),
			}).pipe(Activity.retry({ times: 3 }));
			return;
		}

		const deleted = yield* Activity.make({
			name: "delete-user-lifecycle-database-user",
			error: InternalError satisfies DurableSchema,
			success: Schema.Void satisfies DurableSchema,
			execute: operations.deleteDatabaseUser(payload.operationId),
		}).pipe(Activity.retry({ times: 5 }), Effect.result);
		if (Result.isFailure(deleted)) {
			yield* Activity.make({
				name: "fail-user-lifecycle-database-cleanup",
				error: InternalError satisfies DurableSchema,
				success: Schema.Void satisfies DurableSchema,
				execute: operations.fail(payload.operationId, { code: "database-cleanup-failed" }),
			}).pipe(Activity.retry({ times: 3 }));
			return;
		}

		let resetResult: UserResetResult | null = null;
		if (started.success === "reset") {
			const recreated = yield* Activity.make({
				name: "recreate-reset-user",
				error: InternalError satisfies DurableSchema,
				success: UserResetResult satisfies DurableSchema,
				execute: operations.recreateResetUser(payload.operationId),
			}).pipe(Activity.retry({ times: 5 }), Effect.result);
			if (Result.isFailure(recreated)) {
				yield* Activity.make({
					name: "fail-reset-user-recreation",
					error: InternalError satisfies DurableSchema,
					success: Schema.Void satisfies DurableSchema,
					execute: operations.fail(payload.operationId, { code: "reset-user-recreation-failed" }),
				}).pipe(Activity.retry({ times: 3 }));
				return;
			}
			resetResult = recreated.success;
		}

		const completed = yield* Activity.make({
			name: "complete-user-lifecycle",
			error: InternalError satisfies DurableSchema,
			success: Schema.Void satisfies DurableSchema,
			execute: operations.complete(payload.operationId, resetResult),
		}).pipe(Activity.retry({ times: 5 }), Effect.result);
		if (Result.isFailure(completed)) {
			yield* Activity.make({
				name: "fail-user-lifecycle-completion",
				error: InternalError satisfies DurableSchema,
				success: Schema.Void satisfies DurableSchema,
				execute: operations.fail(payload.operationId, { code: "operation-completion-failed" }),
			}).pipe(Activity.retry({ times: 3 }));
		}
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "UserLifecycleWorkflow" }),
);

export const UserLifecycleWorkflowDefinitionsLive =
	UserLifecycleWorkflow.toLayer(runUserLifecycleWorkflow);
