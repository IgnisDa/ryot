import { DbError } from "@ryot-app/contract/errors";
import type {
	UserLifecycleOperation,
	UserLifecycleOperationFailure,
	UserLifecycleOperationKind,
	UserResetResult,
} from "@ryot-app/contract/modules/god-mode/user-lifecycle";
import { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, desc, eq, inArray, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import * as authSchema from "#lib/infrastructure/db/schema/tables/auth";
import * as automationSchema from "#lib/infrastructure/db/schema/tables/automations";
import * as backupSchema from "#lib/infrastructure/db/schema/tables/backups";
import * as coreSchema from "#lib/infrastructure/db/schema/tables/core";
import * as mutationSchema from "#lib/infrastructure/db/schema/tables/mutations";
import * as uploadSchema from "#lib/infrastructure/db/schema/tables/uploads";
import * as lifecycleSchema from "#lib/infrastructure/db/schema/tables/user-lifecycle";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { ImportsRepository } from "#modules/imports/repository";
import { MutationReceipts } from "#modules/mutations/receipts";

const LifecycleMetadata = Schema.Struct({
	usesLocalAuth: Schema.Boolean,
	recreatedAccountId: Schema.String,
	locators: Schema.Array(ManagedAssetLocator),
	apiKeys: Schema.Array(Schema.Struct({ id: Schema.String, key: Schema.String })),
	accounts: Schema.Array(Schema.Struct({ accountId: Schema.String, providerId: Schema.String })),
	user: Schema.Struct({
		id: UserId,
		name: Schema.String,
		email: Schema.String,
		emailVerified: Schema.Boolean,
		accountGeneration: Schema.String,
		disabledAt: Schema.NullOr(Schema.String),
	}),
});
type LifecycleMetadata = typeof LifecycleMetadata.Type;

type OperationRow = typeof lifecycleSchema.userLifecycleOperation.$inferSelect;

const toOperation = (row: OperationRow): UserLifecycleOperation => ({
	id: row.id,
	kind: row.kind,
	status: row.status,
	failure: row.failure,
	userId: UserId.make(row.userId),
	resetResult: row.resetResult ?? null,
	createdAt: row.createdAt.toISOString(),
	startedAt: row.startedAt?.toISOString() ?? null,
	finishedAt: row.finishedAt?.toISOString() ?? null,
});

const decodeMetadata = (value: unknown) =>
	Schema.decodeUnknownEffect(LifecycleMetadata)(value).pipe(
		Effect.mapError(
			(error) => new DbError({ message: `Invalid user lifecycle metadata: ${String(error)}` }),
		),
	);

const toInternal = (row: OperationRow) =>
	Effect.map(decodeMetadata(row.metadata), (metadata) => ({
		metadata,
		operation: toOperation(row),
		workflowAttempt: row.workflowAttempt,
		accessRevokedAt: row.accessRevokedAt,
		databaseCleanupCompletedAt: row.databaseCleanupCompletedAt,
	}));

const activeStatus = inArray(lifecycleSchema.userLifecycleOperation.status, ["pending", "running"]);

export class UserLifecycleRepository extends Context.Service<UserLifecycleRepository>()(
	"UserLifecycleRepository",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const receipts = yield* MutationReceipts.make;
			const imports = yield* ImportsRepository;
			const listUserMutationWork = Effect.fn("UserLifecycleRepository.listUserMutationWork")(
				function* (userId: UserId) {
					return yield* database.run((db) =>
						db
							.select({
								executionId: mutationSchema.mutationReceipt.executionId,
								workflowName: mutationSchema.mutationReceipt.workflowName,
							})
							.from(mutationSchema.mutationReceipt)
							.where(
								and(
									eq(mutationSchema.mutationReceipt.ownerUserId, userId),
									eq(mutationSchema.mutationReceipt.receiptType, "workflow-owner"),
								),
							),
					);
				},
			);
			const deleteUserData = Effect.fn("UserLifecycleRepository.deleteUserData")(function* (
				userId: UserId,
			) {
				yield* database.transaction(
					Effect.gen(function* () {
						yield* database.acquireUserWriteLock(userId);
						yield* database.run((db) =>
							db
								.select({ id: authSchema.user.id })
								.from(authSchema.user)
								.where(eq(authSchema.user.id, userId))
								.for("update"),
						);
						const privatePluginRows = yield* database.run((db) =>
							db
								.select({ id: coreSchema.plugin.id })
								.from(coreSchema.plugin)
								.where(eq(coreSchema.plugin.ownerId, userId)),
						);
						yield* receipts.retireUserPins(
							userId,
							privatePluginRows.map(({ id }) => id),
						);
						yield* imports.purgePayloadReservations({ userId });
						yield* database.run((db) =>
							Effect.gen(function* () {
								const privatePluginIds = db
									.select({ id: coreSchema.plugin.id })
									.from(coreSchema.plugin)
									.where(eq(coreSchema.plugin.ownerId, userId));
								const ownedRun = or(
									eq(automationSchema.automationRun.executionUserId, userId),
									inArray(automationSchema.automationRun.pluginId, privatePluginIds),
								);
								const [scopedTriggers, recipientTriggers, runTriggers] = yield* Effect.all([
									db
										.select({ id: automationSchema.automationTrigger.id })
										.from(automationSchema.automationTrigger)
										.where(eq(automationSchema.automationTrigger.scopeUserId, userId)),
									db
										.select({ id: automationSchema.automationTriggerRecipient.triggerId })
										.from(automationSchema.automationTriggerRecipient)
										.where(eq(automationSchema.automationTriggerRecipient.userId, userId)),
									db
										.select({ id: automationSchema.automationRun.triggerId })
										.from(automationSchema.automationRun)
										.where(ownedRun),
								]);
								const triggerIds = [
									...new Set(
										[...scopedTriggers, ...recipientTriggers, ...runTriggers].map(({ id }) => id),
									),
								];

								yield* db.delete(automationSchema.automationRun).where(ownedRun);
								yield* db
									.delete(automationSchema.automationTriggerRecipient)
									.where(eq(automationSchema.automationTriggerRecipient.userId, userId));
								yield* db
									.update(automationSchema.automationTrigger)
									.set({ scopeUserId: null })
									.where(eq(automationSchema.automationTrigger.scopeUserId, userId));

								const installationIds = db
									.select({ id: coreSchema.pluginInstallation.id })
									.from(coreSchema.pluginInstallation)
									.where(eq(coreSchema.pluginInstallation.userId, userId));
								yield* db
									.delete(coreSchema.sandboxWorkflowReference)
									.where(
										or(
											inArray(
												coreSchema.sandboxWorkflowReference.scriptId,
												db
													.select({ id: coreSchema.sandboxScript.id })
													.from(coreSchema.sandboxScript)
													.innerJoin(
														coreSchema.pluginRevision,
														eq(
															coreSchema.pluginRevision.id,
															coreSchema.sandboxScript.pluginRevisionId,
														),
													)
													.where(inArray(coreSchema.pluginRevision.pluginId, privatePluginIds)),
											),
											inArray(
												coreSchema.sandboxWorkflowReference.pluginInstallationId,
												installationIds,
											),
										),
									);
								yield* db.delete(authSchema.user).where(eq(authSchema.user.id, userId));

								if (triggerIds.length > 0) {
									yield* db
										.delete(automationSchema.automationTrigger)
										.where(
											and(
												inArray(automationSchema.automationTrigger.id, triggerIds),
												notExists(
													db
														.select({ id: automationSchema.automationRun.id })
														.from(automationSchema.automationRun)
														.where(
															eq(
																automationSchema.automationRun.triggerId,
																automationSchema.automationTrigger.id,
															),
														),
												),
												notExists(
													db
														.select({ userId: automationSchema.automationTriggerRecipient.userId })
														.from(automationSchema.automationTriggerRecipient)
														.where(
															eq(
																automationSchema.automationTriggerRecipient.triggerId,
																automationSchema.automationTrigger.id,
															),
														),
												),
											),
										);
								}
							}),
						);
					}),
				);
			});

			const getActiveByUserId = Effect.fn("UserLifecycleRepository.getActiveByUserId")(function* (
				userId: UserId,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select()
						.from(lifecycleSchema.userLifecycleOperation)
						.where(and(eq(lifecycleSchema.userLifecycleOperation.userId, userId), activeStatus))
						.limit(1),
				);
				return row ? yield* toInternal(row) : null;
			});

			const getInternalById = Effect.fn("UserLifecycleRepository.getInternalById")(function* (
				operationId: string,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select()
						.from(lifecycleSchema.userLifecycleOperation)
						.where(eq(lifecycleSchema.userLifecycleOperation.id, operationId))
						.limit(1),
				);
				return row ? yield* toInternal(row) : null;
			});

			const loadPreparationForUpdate = Effect.fn(
				"UserLifecycleRepository.loadPreparationForUpdate",
			)(function* (userId: UserId, kind: UserLifecycleOperationKind) {
				yield* database.acquireUserWriteLock(userId);
				yield* database.run((db) =>
					db
						.select({ id: authSchema.user.id })
						.from(authSchema.user)
						.where(eq(authSchema.user.id, userId))
						.for("update"),
				);
				const active = yield* getActiveByUserId(userId);
				if (active) {
					return { active, retryable: null, metadata: active.metadata };
				}

				const [failed] = yield* database.run((db) =>
					db
						.select()
						.from(lifecycleSchema.userLifecycleOperation)
						.where(
							and(
								eq(lifecycleSchema.userLifecycleOperation.userId, userId),
								eq(lifecycleSchema.userLifecycleOperation.kind, kind),
								eq(lifecycleSchema.userLifecycleOperation.status, "failed"),
							),
						)
						.orderBy(desc(lifecycleSchema.userLifecycleOperation.createdAt))
						.limit(1),
				);
				if (failed) {
					const retryable = yield* toInternal(failed);
					return { retryable, active: null, metadata: retryable.metadata };
				}

				const [user] = yield* database.run((db) =>
					db
						.select({
							id: authSchema.user.id,
							name: authSchema.user.name,
							email: authSchema.user.email,
							disabledAt: authSchema.user.disabledAt,
							emailVerified: authSchema.user.emailVerified,
							accountGeneration: authSchema.user.accountGeneration,
						})
						.from(authSchema.user)
						.where(eq(authSchema.user.id, userId)),
				);
				if (!user) {
					return null;
				}

				const [accounts, apiKeys, assets, backupArtifacts] = yield* Effect.all([
					database.run((db) =>
						db
							.select({
								accountId: authSchema.account.accountId,
								providerId: authSchema.account.providerId,
							})
							.from(authSchema.account)
							.where(eq(authSchema.account.userId, userId)),
					),
					database.run((db) =>
						db
							.select({ id: authSchema.apikey.id, key: authSchema.apikey.key })
							.from(authSchema.apikey)
							.where(eq(authSchema.apikey.referenceId, userId)),
					),
					database.run((db) =>
						db
							.select({
								key: uploadSchema.managedAsset.key,
								type: uploadSchema.managedAsset.provider,
							})
							.from(uploadSchema.managedAsset)
							.where(eq(uploadSchema.managedAsset.ownerUserId, userId)),
					),
					database.run((db) =>
						db
							.select({
								key: backupSchema.backupRun.artifactKey,
								type: backupSchema.backupRun.artifactProvider,
							})
							.from(backupSchema.backupRun)
							.where(
								and(
									eq(backupSchema.backupRun.userId, userId),
									isNotNull(backupSchema.backupRun.artifactKey),
									isNotNull(backupSchema.backupRun.artifactProvider),
								),
							),
					),
				]);
				const locators = new Map<string, ManagedAssetLocator>();
				for (const { reservation } of yield* imports.listPayloadReservations({ userId })) {
					const locator = yield* Schema.decodeEffect(Schema.fromJsonString(ManagedAssetLocator))(
						reservation.payload.locator,
					).pipe(
						Effect.mapError(
							() => new DbError({ message: "Invalid retained ingestion payload locator" }),
						),
					);
					locators.set(`${locator.type}\0${locator.key}`, locator);
				}
				for (const locator of [...assets, ...backupArtifacts]) {
					if (locator.key !== null && locator.type !== null) {
						locators.set(`${locator.type}\0${locator.key}`, {
							key: locator.key,
							type: locator.type,
						});
					}
				}

				return {
					active: null,
					retryable: null,
					metadata: {
						apiKeys,
						accounts,
						locators: [...locators.values()],
						user: {
							...user,
							id: UserId.make(user.id),
							disabledAt: user.disabledAt?.toISOString() ?? null,
						},
					},
				};
			});

			const create = Effect.fn("UserLifecycleRepository.create")(function* (input: {
				id: string;
				userId: UserId;
				metadata: LifecycleMetadata;
				kind: UserLifecycleOperationKind;
			}) {
				const [row] = yield* database.run((db) =>
					db
						.insert(lifecycleSchema.userLifecycleOperation)
						.values({ ...input, status: "pending" })
						.returning(),
				);
				return row
					? yield* toInternal(row)
					: yield* new DbError({ message: "Lifecycle operation was not inserted" });
			});

			const reactivateFailed = Effect.fn("UserLifecycleRepository.reactivateFailed")(function* (
				operationId: string,
			) {
				const [row] = yield* database.run((db) =>
					db
						.update(lifecycleSchema.userLifecycleOperation)
						.set({
							finishedAt: null,
							status: "pending",
							workflowAttempt: sql`${lifecycleSchema.userLifecycleOperation.workflowAttempt} + 1`,
						})
						.where(
							and(
								eq(lifecycleSchema.userLifecycleOperation.id, operationId),
								eq(lifecycleSchema.userLifecycleOperation.status, "failed"),
							),
						)
						.returning(),
				);
				return row ? yield* toInternal(row) : null;
			});

			const listPending = Effect.fn("UserLifecycleRepository.listPending")(function* (
				limit: number,
			) {
				const rows = yield* database.run((db) =>
					db
						.select()
						.from(lifecycleSchema.userLifecycleOperation)
						.where(eq(lifecycleSchema.userLifecycleOperation.status, "pending"))
						.orderBy(lifecycleSchema.userLifecycleOperation.createdAt)
						.limit(limit),
				);
				return yield* Effect.forEach(rows, toInternal);
			});

			const claimAccessRevocation = Effect.fn("UserLifecycleRepository.claimAccessRevocation")(
				function* (operationId: string, staleBefore: Date) {
					const now = yield* DateTime.nowAsDate;
					const [row] = yield* database.run((db) =>
						db
							.update(lifecycleSchema.userLifecycleOperation)
							.set({ accessRevocationStartedAt: now })
							.where(
								and(
									eq(lifecycleSchema.userLifecycleOperation.id, operationId),
									eq(lifecycleSchema.userLifecycleOperation.status, "pending"),
									isNull(lifecycleSchema.userLifecycleOperation.accessRevokedAt),
									or(
										isNull(lifecycleSchema.userLifecycleOperation.accessRevocationStartedAt),
										lt(
											lifecycleSchema.userLifecycleOperation.accessRevocationStartedAt,
											staleBefore,
										),
									),
								),
							)
							.returning(),
					);
					return row ? yield* toInternal(row) : null;
				},
			);

			const releaseAccessRevocation = Effect.fn("UserLifecycleRepository.releaseAccessRevocation")(
				function* (operationId: string) {
					yield* database.run((db) =>
						db
							.update(lifecycleSchema.userLifecycleOperation)
							.set({ accessRevocationStartedAt: null })
							.where(
								and(
									eq(lifecycleSchema.userLifecycleOperation.id, operationId),
									isNull(lifecycleSchema.userLifecycleOperation.accessRevokedAt),
								),
							),
					);
				},
			);

			const markAccessRevoked = Effect.fn("UserLifecycleRepository.markAccessRevoked")(function* (
				operationId: string,
			) {
				const operation = yield* getInternalById(operationId);
				if (operation?.accessRevokedAt !== null) {
					return operation;
				}
				const now = yield* DateTime.nowAsDate;
				const [row] = yield* database.run((db) =>
					db
						.update(lifecycleSchema.userLifecycleOperation)
						.set({
							accessRevokedAt: now,
							accessRevocationStartedAt: null,
							metadata: { ...operation.metadata, apiKeys: [] },
						})
						.where(eq(lifecycleSchema.userLifecycleOperation.id, operationId))
						.returning(),
				);
				return row ? yield* toInternal(row) : null;
			});

			const markRunning = Effect.fn("UserLifecycleRepository.markRunning")(function* (
				operationId: string,
			) {
				const now = yield* DateTime.nowAsDate;
				yield* database.run((db) =>
					db
						.update(lifecycleSchema.userLifecycleOperation)
						.set({ startedAt: now, status: "running" })
						.where(
							and(
								eq(lifecycleSchema.userLifecycleOperation.id, operationId),
								eq(lifecycleSchema.userLifecycleOperation.status, "pending"),
							),
						),
				);
				return yield* getInternalById(operationId);
			});

			const markDatabaseCleanupCompleted = Effect.fn(
				"UserLifecycleRepository.markDatabaseCleanupCompleted",
			)(function* (operationId: string) {
				const now = yield* DateTime.nowAsDate;
				yield* database.run((db) =>
					db
						.update(lifecycleSchema.userLifecycleOperation)
						.set({ databaseCleanupCompletedAt: now })
						.where(
							and(
								eq(lifecycleSchema.userLifecycleOperation.id, operationId),
								eq(lifecycleSchema.userLifecycleOperation.status, "running"),
							),
						),
				);
			});

			const markCompleted = Effect.fn("UserLifecycleRepository.markCompleted")(function* (
				operationId: string,
				resetResult: UserResetResult | null,
			) {
				const now = yield* DateTime.nowAsDate;
				const [completed] = yield* database.run((db) =>
					db
						.update(lifecycleSchema.userLifecycleOperation)
						.set({
							failure: null,
							finishedAt: now,
							status: "completed",
							resetResult: resetResult ?? null,
						})
						.where(
							and(
								eq(lifecycleSchema.userLifecycleOperation.id, operationId),
								eq(lifecycleSchema.userLifecycleOperation.status, "running"),
							),
						)
						.returning({ userId: lifecycleSchema.userLifecycleOperation.userId }),
				);
				if (completed && resetResult !== null) {
					const [enabled] = yield* database.run((db) =>
						db
							.update(authSchema.user)
							.set({ updatedAt: now, disabledAt: null })
							.where(eq(authSchema.user.id, completed.userId))
							.returning({ id: authSchema.user.id }),
					);
					if (!enabled) {
						return yield* new DbError({ message: "Reset user was not available for completion" });
					}
				}
				return undefined;
			});

			const markFailed = Effect.fn("UserLifecycleRepository.markFailed")(function* (
				operationId: string,
				failure: UserLifecycleOperationFailure,
			) {
				const now = yield* DateTime.nowAsDate;
				yield* database.run((db) =>
					db
						.update(lifecycleSchema.userLifecycleOperation)
						.set({ failure, finishedAt: now, status: "failed" })
						.where(
							and(
								eq(lifecycleSchema.userLifecycleOperation.id, operationId),
								inArray(lifecycleSchema.userLifecycleOperation.status, ["pending", "running"]),
							),
						),
				);
			});

			const userExists = Effect.fn("UserLifecycleRepository.userExists")(function* (
				userId: UserId,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select({ id: authSchema.user.id })
						.from(authSchema.user)
						.where(eq(authSchema.user.id, userId))
						.limit(1),
				);
				return row !== undefined;
			});

			const loadRecreatedIdentity = Effect.fn("UserLifecycleRepository.loadRecreatedIdentity")(
				function* (userId: UserId) {
					const [user] = yield* database.run((db) =>
						db
							.select({ id: authSchema.user.id, email: authSchema.user.email })
							.from(authSchema.user)
							.where(eq(authSchema.user.id, userId))
							.limit(1),
					);
					if (!user) {
						return null;
					}
					const accounts = yield* database.run((db) =>
						db
							.select({
								accountId: authSchema.account.accountId,
								providerId: authSchema.account.providerId,
							})
							.from(authSchema.account)
							.where(eq(authSchema.account.userId, userId)),
					);
					return { user, accounts };
				},
			);

			return {
				create,
				userExists,
				markFailed,
				markRunning,
				listPending,
				markCompleted,
				deleteUserData,
				getInternalById,
				reactivateFailed,
				markAccessRevoked,
				listUserMutationWork,
				claimAccessRevocation,
				loadRecreatedIdentity,
				releaseAccessRevocation,
				loadPreparationForUpdate,
				markDatabaseCleanupCompleted,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ImportsRepository.layer),
	);
}
