import type { InternalError } from "@ryot-app/contract/errors";
import { internalError } from "@ryot-app/contract/errors";
import type {
	UserLifecycleOperationFailure,
	UserLifecycleOperationKind,
	UserResetResult,
} from "@ryot-app/contract/modules/instance-admin/user-lifecycle";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, DateTime, Effect, Layer, Option, Result } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { AuthService } from "#modules/accounts/auth/service";
import { userBootstrapWorkflowExecutionId } from "#modules/accounts/provisioning/scheduling";
import { UserBootstrapWorkflow } from "#modules/accounts/provisioning/workflow";
import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { IngestionExecution } from "#modules/imports/execution-service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { DatabaseSession } from "#platform/db/session";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";
import { WorkflowAccounts } from "#platform/workflow/account";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { interruptExecutionAndWait } from "#platform/workflow/interruption";

import { UserLifecycleRepository } from "./repository";
import { UserLifecycleJob, UserLifecycleService } from "./service";

type UserLifecycleJobOperationsValue = {
	bootstrapResetUser: (userId: UserId) => Effect.Effect<void, InternalError>;
	cleanupObjects: (operationId: string) => Effect.Effect<void, InternalError>;
	deleteDatabaseUser: (operationId: string) => Effect.Effect<void, InternalError>;
	recreateResetUser: (operationId: string) => Effect.Effect<UserId, InternalError>;
	finishResetUser: (operationId: string) => Effect.Effect<UserResetResult, InternalError>;
	begin: (operationId: string) => Effect.Effect<null | UserLifecycleOperationKind, InternalError>;
	complete: (
		operationId: string,
		result: null | UserResetResult,
	) => Effect.Effect<void, InternalError>;
	fail: (
		operationId: string,
		failure: UserLifecycleOperationFailure,
	) => Effect.Effect<void, InternalError>;
};

export class UserLifecycleJobOperations extends Context.Service<
	UserLifecycleJobOperations,
	UserLifecycleJobOperationsValue
>()("@ryot-app/kernel-backend/modules/accounts/lifecycle/job/UserLifecycleJobOperations") {}

const asInternal = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
	effect.pipe(
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) => Effect.logError(message, cause).pipe(Effect.andThen(internalError(message))),
		),
		Effect.mapError(() => internalError(message)),
	);

export const UserLifecycleJobOperationsLive = Layer.effect(
	UserLifecycleJobOperations,
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const database = yield* DatabaseSession;
		const repository = yield* UserLifecycleRepository;
		const objectStorage = yield* ObjectStorageService;
		const engine = yield* WorkflowEngine;
		const notifications = yield* WorkflowExecutionNotifications;
		const receipts = yield* MutationReceipts.make;
		const accounts = yield* WorkflowAccounts;
		const ingestion = yield* IngestionExecution;

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
					for (const identity of yield* accounts.listActive(operation.operation.userId)) {
						yield* interruptExecutionAndWait(identity).pipe(
							Effect.provideService(WorkflowEngine, engine),
							Effect.provideService(WorkflowExecutionNotifications, notifications),
						);
					}
					yield* ingestion.retire({ userId: operation.operation.userId });
					yield* Effect.forEach(operation.metadata.locators, objectStorage.deleteObject, {
						discard: true,
						concurrency: 1,
					});
					return yield* Effect.void;
				}),
				"User-owned object cleanup failed",
			);

		const deleteDatabaseUser = (operationId: string) =>
			asInternal(
				Effect.gen(function* () {
					const operation = yield* requireOperation(operationId);
					if (operation.databaseCleanupCompletedAt !== null) {
						return yield* Effect.void;
					}
					yield* repository.deleteUserData(operation.operation.userId);
					yield* repository.markDatabaseCleanupCompleted(operationId);
					return yield* Effect.void;
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
						});
					}

					return operation.operation.userId;
				}),
				"Reset user recreation failed",
			);

		const bootstrapResetUser = (userId: UserId) =>
			asInternal(
				Effect.gen(function* () {
					const accountGeneration = yield* receipts.currentAccount(userId);
					const executionId = userBootstrapWorkflowExecutionId(userId, accountGeneration);
					return yield* dispatchAdmittedWorkflow(engine, UserBootstrapWorkflow, accountGeneration, {
						executionId,
						payload: { userId, accountGeneration },
					}).pipe(Effect.asVoid);
				}),
				"Reset user bootstrap failed",
			);

		const finishResetUser = (operationId: string) =>
			asInternal(
				Effect.gen(function* () {
					const operation = yield* requireOperation(operationId);
					const { metadata } = operation;
					const resetUrl = metadata.usesLocalAuth
						? (yield* auth.requestPasswordResetLink(metadata.user.email)).resetUrl
						: null;
					return { resetUrl, email: metadata.user.email, userId: operation.operation.userId };
				}),
				"Reset user completion failed",
			);

		const complete = (operationId: string, result: null | UserResetResult) =>
			asInternal(
				database.transaction(repository.markCompleted(operationId, result)),
				"User lifecycle completion could not be recorded",
			);
		const fail = (operationId: string, failure: UserLifecycleOperationFailure) =>
			asInternal(
				repository.markFailed(operationId, failure),
				"User lifecycle failure could not be recorded",
			);
		return {
			fail,
			begin,
			complete,
			cleanupObjects,
			finishResetUser,
			recreateResetUser,
			bootstrapResetUser,
			deleteDatabaseUser,
		} satisfies UserLifecycleJobOperationsValue;
	}),
);

// Each step is idempotent, so a retried job resumes where the last attempt stopped. Only the last
// attempt records a failure, after which the operation can be requested again.
export const runUserLifecycleJob = Effect.fn("UserLifecycleJob")(function* (
	payload: typeof UserLifecycleJob.payload.Type,
	job: JobContext,
) {
	yield* Effect.annotateCurrentSpan({ jobId: job.id, operationId: payload.operationId });
	const operations = yield* UserLifecycleJobOperations;
	const service = yield* UserLifecycleService;
	const step = Effect.fnUntraced(function* <A, E>(
		effect: Effect.Effect<A, E>,
		code: UserLifecycleOperationFailure["code"],
	) {
		const result = yield* Effect.result(effect);
		if (Result.isSuccess(result)) {
			return Option.some(result.success);
		}
		if (job.attempt < UserLifecycleJob.maxAttempts) {
			return yield* Effect.fail(result.failure);
		}
		yield* operations.fail(payload.operationId, { code });
		return Option.none<A>();
	});

	const revoked = yield* step(
		service.ensureAccessRevoked(payload.operationId),
		"operation-start-failed",
	);
	if (Option.isNone(revoked)) {
		return;
	}
	const started = yield* step(operations.begin(payload.operationId), "operation-start-failed");
	if (Option.isNone(started) || started.value === null) {
		return;
	}
	const cleaned = yield* step(
		operations.cleanupObjects(payload.operationId),
		"object-cleanup-failed",
	);
	if (Option.isNone(cleaned)) {
		return;
	}
	const deleted = yield* step(
		operations.deleteDatabaseUser(payload.operationId),
		"database-cleanup-failed",
	);
	if (Option.isNone(deleted)) {
		return;
	}
	let resetResult: null | UserResetResult = null;
	if (started.value === "reset") {
		const finished = yield* step(
			Effect.gen(function* () {
				const userId = yield* operations.recreateResetUser(payload.operationId);
				yield* operations.bootstrapResetUser(userId);
				return yield* operations.finishResetUser(payload.operationId);
			}),
			"reset-user-recreation-failed",
		);
		if (Option.isNone(finished)) {
			return;
		}
		resetResult = finished.value;
	}
	yield* step(operations.complete(payload.operationId, resetResult), "operation-completion-failed");
});

export const UserLifecycleJobLive = registerJobHandler(UserLifecycleJob, runUserLifecycleJob);
