import { DbError } from "@ryot-app/contract/errors";
import { dataJsonSource } from "@ryot-app/contract/modules/imports/data-json";
import {
	IngestionActivity,
	IngestionBatch,
	IngestionBlockReason,
	IngestionCapture,
	IngestionIssue,
	IngestionOutcome,
	IngestionPayload,
	IngestionPins,
	IngestionPlan,
	IngestionRun,
	type IngestionScope,
	type IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import type {
	ImportRunFailureReason,
	ListedImportRun,
} from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunSource } from "@ryot-app/contract/modules/imports/types";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import {
	ImportRunId,
	IntegrationId,
	PluginId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	type AnyColumn,
	and,
	asc,
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { Context, DateTime, Duration, Effect, Layer, Schema, Struct } from "effect";

import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { lockPluginIngestionShared } from "#modules/plugins/packages/ingestion-fence";
import type { PluginIngestionRetirementPolicy } from "#modules/plugins/packages/ingestion-retirement";
import { samePluginPin } from "#modules/scripts/authorization/principal";
import { isUniqueConstraintError } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import {
	PreparedIngestionRelease,
	PreparedIngestionReleaseCiphertext,
} from "./runtime/prepared-release";
import type { IngestionRecoveryCursor } from "./runtime/recovery-cursor";
import { ImportSourceState } from "./runtime/source-state";
import { ImportRunError } from "./runtime/workflow-errors";

const BLOCKED_IMPORT_WINDOW = Duration.weeks(1);

type ImportRunRow = typeof schema.importRun.$inferSelect;

const IngestionRunControl = Schema.Struct(
	Struct.omit(IngestionRun.fields, ["summary", "activities"]),
);

export type ImportRunExecutionKind = "source" | "integration";

const executionKind = (row: { integrationId: null | string }) =>
	row.integrationId === null ? ("source" as const) : ("integration" as const);

const normalizeRun = (row: ImportRunRow): ListedImportRun => ({
	source: row.source,
	status: row.status,
	id: ImportRunId.make(row.id),
	inputSummary: row.inputSummary,
	failureReason: row.failureReason,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	startedAt: row.startedAt?.toISOString() ?? null,
	finishedAt: row.finishedAt?.toISOString() ?? null,
});

const PayloadItem = Schema.Struct({
	payload: IngestionPayload,
	phase: IngestionCapture.fields.phase,
	checkpoint: IngestionCapture.fields.checkpoint,
	inputFingerprint: Schema.NonEmptyString,
	ordinal: Schema.NullOr(IngestionCapture.fields.ordinal),
	stagingExecutionId: Schema.NullOr(Schema.String),
	state: Schema.Literals(["captured", "sealed"]),
});

type ImportItemRow = typeof schema.importItem.$inferSelect;

/** Rows hold what this repository wrote, so a value that does not decode is a defect. */
const decodeItem =
	<A, I>(codec: Schema.Codec<A, I>) =>
	(data: unknown) =>
		Effect.orDie(Schema.decodeUnknownEffect(codec)(data));

const decodePayloadItem = Effect.fnUntraced(function* (row: ImportItemRow) {
	const data = yield* decodeItem(PayloadItem)(row.data);
	return {
		id: row.id,
		runId: row.runId,
		ordinal: data.ordinal,
		payload: data.payload,
		released: row.released,
		retiring: row.retiring,
		captureState: data.state,
		capturePhase: data.phase,
		checkpoint: data.checkpoint,
		writeStarted: row.writeStarted,
		recoveryBytes: row.recoveryBytes,
		inputFingerprint: data.inputFingerprint,
		stagingExecutionId: data.stagingExecutionId,
	};
});

export type PayloadReservation = Effect.Success<ReturnType<typeof decodePayloadItem>>;

const decodeCapture = Effect.fnUntraced(function* (row: ImportItemRow) {
	const data = yield* decodeItem(PayloadItem)(row.data);
	return yield* Schema.decodeUnknownEffect(IngestionCapture)({
		id: row.id,
		phase: data.phase,
		ordinal: data.ordinal,
		checkpoint: data.checkpoint,
		payload: row.captureReleased ? null : data.payload,
		state: row.captureReleased ? "released" : data.state,
	}).pipe(Effect.orDie);
});

const decodeBatch = decodeItem(IngestionBatch);

const itemsOf = (kind: ImportItemRow["kind"], runId: string) =>
	and(eq(schema.importItem.kind, kind), eq(schema.importItem.runId, runId));

const itemOf = (kind: ImportItemRow["kind"], runId: string, id: string) =>
	and(itemsOf(kind, runId), eq(schema.importItem.id, id));

const ownedPublished = (scope: IngestionScope) =>
	and(itemsOf("payload", scope.runId), eq(schema.importItem.published, true));

const unreleasedPayload = (runId: SQL | AnyColumn) =>
	sql`exists (select 1 from ${schema.importItem} where ${schema.importItem.kind} = 'payload' and ${schema.importItem.runId} = ${runId} and not ${schema.importItem.released})`;

const DataSubmission = Schema.Struct({
	runId: Schema.String,
	uploadTokenHashes: Schema.Array(Schema.String),
});

const dataSubmissionKey = (integrationId: null | IntegrationId, key: string) =>
	`data-import:${stableStringify([integrationId, key])}`;

const owned = (scope: IngestionScope) =>
	and(eq(schema.importRun.id, scope.runId), eq(schema.importRun.userId, scope.userId));

const preparedReleaseEncryptionPurpose = "ryot/ingestion/prepared-release";

const executableOwner = () => sql`
	(${schema.importRun.integrationId} is null or exists (select 1 from ${schema.integration} where ${schema.integration.id} = ${schema.importRun.integrationId} and not ${schema.integration.retiring}))
	and (${schema.importRun.pluginInstallationId} is null or exists (select 1 from ${schema.pluginInstallation} where ${schema.pluginInstallation.id} = ${schema.importRun.pluginInstallationId} and ${schema.pluginInstallation.userId} = ${schema.importRun.userId} and ${schema.pluginInstallation.health} = 'ready' and not ${schema.pluginInstallation.ingestionRetiring} and ${schema.pluginInstallation.uninstalledAt} is null))
`;

export class ImportsRepository extends Context.Service<ImportsRepository>()(
	"@ryot-app/kernel-backend/modules/imports/repository/ImportsRepository",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const encryptionKeys = yield* PluginConfigEncryptionKey;
			const encryptPreparedRelease = Effect.fn("ImportsRepository.encryptPreparedRelease")(
				function* (scope: IngestionScope, prepared: PreparedIngestionRelease) {
					const plaintext = yield* Schema.encodeEffect(Schema.fromJsonString(ImportSourceState))(
						prepared.state,
					);
					const state = yield* (yield* encryptionKeys.load).encryptWithSubkey(
						preparedReleaseEncryptionPurpose,
						plaintext,
						scope,
					);
					return yield* Schema.decodeEffect(PreparedIngestionReleaseCiphertext)({
						...prepared,
						state,
					});
				},
			);
			const decryptPreparedRelease = Effect.fn("ImportsRepository.decryptPreparedRelease")(
				function* (scope: IngestionScope, input: unknown) {
					const encrypted = yield* Schema.decodeUnknownEffect(PreparedIngestionReleaseCiphertext)(
						input,
					);
					const plaintext = yield* (yield* encryptionKeys.load).decryptWithSubkey(
						preparedReleaseEncryptionPurpose,
						encrypted.state,
						scope,
					);
					const state = yield* Schema.decodeEffect(Schema.fromJsonString(ImportSourceState))(
						plaintext,
					);
					return yield* Schema.decodeEffect(PreparedIngestionRelease)({ ...encrypted, state });
				},
			);
			const assertAdmissionOwner = Effect.fn("ImportsRepository.assertAdmissionOwner")(
				function* (input: {
					userId: UserId;
					integrationId: null | IntegrationId;
					pluginInstallationId: null | string;
				}) {
					yield* database.requireTransaction;
					if (input.pluginInstallationId !== null) {
						yield* lockPluginIngestionShared(database, [input.userId]);
					}
					yield* database.acquireUserWriteLock(input.userId);
					const integrationId = input.integrationId;
					const pluginInstallationId = input.pluginInstallationId;
					if (integrationId !== null) {
						const [owner] = yield* database.run((db) =>
							db
								.select({ id: schema.integration.id })
								.from(schema.integration)
								.where(
									and(
										eq(schema.integration.id, integrationId),
										eq(schema.integration.userId, input.userId),
										eq(schema.integration.retiring, false),
									),
								)
								.limit(1),
						);
						if (!owner) {
							return yield* new DbError({ message: "Integration ingestion owner has retired" });
						}
					}
					if (pluginInstallationId !== null) {
						const [owner] = yield* database.run((db) =>
							db
								.select({ id: schema.pluginInstallation.id })
								.from(schema.pluginInstallation)
								.where(
									and(
										eq(schema.pluginInstallation.id, pluginInstallationId),
										eq(schema.pluginInstallation.userId, input.userId),
										eq(schema.pluginInstallation.ingestionRetiring, false),
										eq(schema.pluginInstallation.health, "ready"),
										isNull(schema.pluginInstallation.uninstalledAt),
									),
								)
								.limit(1),
						);
						if (!owner) {
							return yield* new DbError({ message: "Installation ingestion owner has retired" });
						}
					}
					return yield* Effect.void;
				},
			);
			const insertRun = Effect.fn("ImportsRepository.insertRun")(function* (input: {
				userId: UserId;
				source: ImportRunSource;
				pluginInstallationId: null | string;
				integrationId: null | IntegrationId;
				inputSummary: Record<string, unknown>;
				integrationLot: null | IntegrationLot;
			}) {
				yield* assertAdmissionOwner(input);
				const [row] = yield* database.run((db) =>
					db
						.insert(schema.importRun)
						.values({
							userId: input.userId,
							source: input.source,
							inputSummary: input.inputSummary,
							integrationId: input.integrationId,
							integrationLot: input.integrationLot,
							pluginInstallationId: input.pluginInstallationId,
						})
						.returning(),
				);
				if (!row) {
					return yield* new DbError({ message: "Import run insert returned no row" });
				}
				return normalizeRun(row);
			});

			const createManualRun = Effect.fn("ImportsRepository.createManualRun")(function* (input: {
				userId: UserId;
				source: ImportRunSource;
				pluginInstallationId: null | string;
				inputSummary: Record<string, unknown>;
			}) {
				return yield* insertRun({ ...input, integrationId: null, integrationLot: null });
			});

			const createIntegrationRun = Effect.fn("ImportsRepository.createIntegrationRun")(
				function* (input: {
					userId: UserId;
					source: ImportRunSource;
					integrationId: IntegrationId;
					integrationLot: IntegrationLot;
					pluginInstallationId: null | string;
					inputSummary: Record<string, unknown>;
				}) {
					return yield* insertRun(input);
				},
			);

			const createIntegrationRunIfIdle = Effect.fn("ImportsRepository.createIntegrationRunIfIdle")(
				function* (input: {
					userId: UserId;
					source: ImportRunSource;
					integrationId: IntegrationId;
					pluginInstallationId: string;
					inputSummary: Record<string, unknown>;
				}) {
					yield* database.requireTransaction;
					yield* lockPluginIngestionShared(database, [input.userId]);
					yield* database.acquireUserWriteLock(input.userId);
					const [user] = yield* database.run((db) =>
						db
							.select({ id: schema.user.id })
							.from(schema.user)
							.where(and(eq(schema.user.id, input.userId), isNull(schema.user.disabledAt)))
							.for("share"),
					);
					if (!user) {
						return null;
					}
					return yield* createIntegrationRun({ ...input, integrationLot: "yank" }).pipe(
						Effect.catchIf(isUniqueConstraintError("import_run_integration_active_unique"), () =>
							Effect.succeed(null),
						),
					);
				},
			);

			const admitDataSubmission = Effect.fn("ImportsRepository.admitDataSubmission")(
				function* (input: {
					userId: UserId;
					digest: string;
					runId: ImportRunId;
					submissionKey: null | string;
					uploadTokenHash: null | string;
					integrationId: null | IntegrationId;
					payload: IngestionCapture["payload"];
					inputSummary: Record<string, unknown>;
				}) {
					yield* assertAdmissionOwner({
						userId: input.userId,
						pluginInstallationId: null,
						integrationId: input.integrationId,
					});
					const runId = input.runId;
					if (input.submissionKey !== null) {
						const key = dataSubmissionKey(input.integrationId, input.submissionKey);
						const [claim] = yield* database.run((db) =>
							db
								.insert(schema.idempotencyKey)
								.values({
									key,
									userId: input.userId,
									fingerprint: input.digest,
									response: {
										runId,
										uploadTokenHashes: input.uploadTokenHash === null ? [] : [input.uploadTokenHash],
									},
								})
								.onConflictDoNothing()
								.returning({ key: schema.idempotencyKey.key }),
						);
						if (!claim) {
							const [existing] = yield* database.run((db) =>
								db
									.select({
										response: schema.idempotencyKey.response,
										fingerprint: schema.idempotencyKey.fingerprint,
									})
									.from(schema.idempotencyKey)
									.where(
										and(
											eq(schema.idempotencyKey.userId, input.userId),
											eq(schema.idempotencyKey.key, key),
										),
									)
									.limit(1),
							);
							if (!existing) {
								return yield* new DbError({ message: "Submission claim is unavailable" });
							}
							const submission = yield* decodeItem(DataSubmission)(existing.response);
							const { uploadTokenHash } = input;
							if (
								existing.fingerprint === input.digest &&
								uploadTokenHash !== null &&
								!submission.uploadTokenHashes.includes(uploadTokenHash)
							) {
								yield* database.run((db) =>
									db
										.update(schema.idempotencyKey)
										.set({
											response: {
												...submission,
												uploadTokenHashes: [...submission.uploadTokenHashes, uploadTokenHash],
											},
										})
										.where(
											and(
												eq(schema.idempotencyKey.userId, input.userId),
												eq(schema.idempotencyKey.key, key),
											),
										),
								);
							}
							return {
								created: false,
								digest: existing.fingerprint,
								runId: ImportRunId.make(submission.runId),
							};
						}
					}
					yield* database.run((db) =>
						db.insert(schema.importRun).values({
							id: runId,
							userId: input.userId,
							source: dataJsonSource,
							inputSummary: input.inputSummary,
							integrationId: input.integrationId,
							integrationLot: input.integrationId === null ? null : "sink",
						}),
					);
					if (!input.payload) {
						return yield* new DbError({ message: "Data ingestion payload is missing" });
					}
					const scope = { runId, userId: input.userId };
					yield* reservePayload(scope, {
						ordinal: 0,
						checkpoint: null,
						id: "admitted-data",
						recoveryBytes: null,
						captureState: "sealed",
						payload: input.payload,
						capturePhase: "collection",
						inputFingerprint: input.payload.checksum,
					});
					return { runId, created: true, digest: input.digest };
				},
			);
			const findDataUploadRetry = Effect.fn("ImportsRepository.findDataUploadRetry")(
				function* (input: { key: string; userId: UserId; uploadTokenHash: string }) {
					const [row] = yield* database.run((db) =>
						db
							.select({ response: schema.idempotencyKey.response })
							.from(schema.idempotencyKey)
							.where(
								and(
									eq(schema.idempotencyKey.userId, input.userId),
									eq(schema.idempotencyKey.key, dataSubmissionKey(null, input.key)),
								),
							)
							.limit(1),
					);
					if (!row) {
						return null;
					}
					const submission = yield* decodeItem(DataSubmission)(row.response);
					return submission.uploadTokenHashes.includes(input.uploadTokenHash)
						? ImportRunId.make(submission.runId)
						: null;
				},
			);

			const getRunById = Effect.fn("ImportsRepository.getRunById")(function* (input: {
				userId: UserId;
				runId: ImportRunId;
			}) {
				const [row] = yield* database.run((db) =>
					db
						.select()
						.from(schema.importRun)
						.where(
							and(eq(schema.importRun.id, input.runId), eq(schema.importRun.userId, input.userId)),
						)
						.limit(1),
				);
				return row ? normalizeRun(row) : null;
			});

			const getRunControlForUser = Effect.fn("ImportsRepository.getRunControlForUser")(
				function* (input: { userId: UserId; runId: ImportRunId }) {
					const [row] = yield* database.run((db) =>
						db
							.select({
								id: schema.importRun.id,
								status: schema.importRun.status,
								integrationId: schema.importRun.integrationId,
							})
							.from(schema.importRun)
							.where(
								and(
									eq(schema.importRun.id, input.runId),
									eq(schema.importRun.userId, input.userId),
								),
							)
							.limit(1),
					);
					return row
						? {
								status: row.status,
								id: ImportRunId.make(row.id),
								executionKind: executionKind(row),
							}
						: null;
				},
			);

			const listRecentStatusesByIntegrationId = Effect.fn(
				"ImportsRepository.listRecentStatusesByIntegrationId",
			)(function* (input: { limit: number; integrationId: IntegrationId }) {
				return yield* database.run((db) =>
					db
						.select({ status: schema.importRun.status })
						.from(schema.importRun)
						.where(eq(schema.importRun.integrationId, input.integrationId))
						.orderBy(desc(schema.importRun.createdAt))
						.limit(input.limit),
				);
			});

			const updateInputSummary = Effect.fn("ImportsRepository.updateInputSummary")(
				function* (input: { runId: ImportRunId; inputSummary: Record<string, unknown> }) {
					const rows = yield* database.run((db) =>
						db
							.update(schema.importRun)
							.set({ inputSummary: input.inputSummary })
							.where(
								and(eq(schema.importRun.id, input.runId), eq(schema.importRun.status, "pending")),
							)
							.returning({ id: schema.importRun.id }),
					);
					return rows.length > 0;
				},
			);

			const deleteRunById = Effect.fn("ImportsRepository.deleteRunById")(function* (input: {
				userId: UserId;
				runId: ImportRunId;
			}) {
				yield* database.run((db) =>
					db
						.delete(schema.importRun)
						.where(
							and(eq(schema.importRun.id, input.runId), eq(schema.importRun.userId, input.userId)),
						),
				);
			});

			const lockProjection = Effect.fn("ImportsRepository.lockProjection")(function* (
				scope: IngestionScope,
				statuses: ReadonlyArray<ImportRunRow["status"]> = ["running"],
			) {
				yield* database.requireTransaction;
				yield* database.acquireUserWriteLock(scope.userId);
				const [run] = yield* database.run((db) =>
					db
						.select()
						.from(schema.importRun)
						.where(and(owned(scope), inArray(schema.importRun.status, [...statuses])))
						.for("update")
						.limit(1),
				);
				if (!run) {
					return yield* new DbError({ message: "Ingestion owner is not active" });
				}
				return run;
			});
			const checkCaptureOwner = Effect.fn("ImportsRepository.checkCaptureOwner")(function* (
				scope: IngestionScope,
			) {
				yield* database.requireTransaction;
				yield* lockPluginIngestionShared(database, [scope.userId]);
				const [owner] = yield* database.run((db) =>
					db
						.select({
							pins: schema.importRun.pins,
							status: schema.importRun.status,
							health: schema.pluginInstallation.health,
							pluginId: schema.pluginInstallation.pluginId,
							isHidden: schema.pluginInstallation.isHidden,
							failureReason: schema.importRun.failureReason,
							installationId: schema.importRun.pluginInstallationId,
							retiring: schema.pluginInstallation.ingestionRetiring,
							uninstalledAt: schema.pluginInstallation.uninstalledAt,
							incompatibilityReason: schema.pluginInstallation.incompatibilityReason,
						})
						.from(schema.importRun)
						.leftJoin(
							schema.pluginInstallation,
							and(
								eq(schema.pluginInstallation.id, schema.importRun.pluginInstallationId),
								eq(schema.pluginInstallation.userId, scope.userId),
							),
						)
						.where(
							and(
								owned(scope),
								sql`exists (select 1 from ${schema.user} where ${schema.user.id} = ${scope.userId} and ${schema.user.disabledAt} is null)`,
							),
						)
						.limit(1),
				);
				if (
					owner &&
					owner.installationId !== null &&
					owner.pluginId !== null &&
					(owner.health === "incompatible" ||
						owner.incompatibilityReason !== null ||
						owner.isHidden ||
						owner.retiring ||
						owner.uninstalledAt !== null ||
						(owner.health !== "ready" &&
							!(
								owner.pins &&
								(owner.health === "installing" || owner.health === "needs-configuration")
							)))
				) {
					return yield* new ImportRunError({
						message: "Ingestion installation is unavailable",
						reason: {
							installationId: owner.installationId,
							pluginId: PluginId.make(owner.pluginId),
							code:
								owner.incompatibilityReason === "package-identity-conflict"
									? "package-identity-conflict"
									: "installation-unavailable",
						},
					});
				}
				if (
					!owner ||
					!["pending", "blocked", "running"].includes(owner.status) ||
					(owner.installationId !== null && owner.pluginId === null)
				) {
					return yield* new ImportRunError({
						message: "Ingestion capture owner is not active",
						...(owner?.failureReason?.code === "package-identity-conflict"
							? { reason: owner.failureReason }
							: {}),
					});
				}
				return yield* Effect.void;
			});
			const reservePayload = Effect.fn("ImportsRepository.reservePayload")(function* (
				scope: IngestionScope,
				input: {
					id: string;
					checkpoint: IngestionCapture["checkpoint"];
					ordinal: null | number;
					inputFingerprint: string;
					payload: IngestionPayload;
					recoveryBytes?: null | string;
					captureState: "sealed" | "captured";
					stagingExecutionId?: null | string;
					capturePhase: IngestionCapture["phase"];
				},
			) {
				yield* checkCaptureOwner(scope);
				yield* lockProjection(scope, ["pending", "blocked", "running"]);
				const data = yield* Schema.encodeUnknownEffect(PayloadItem)({
					ordinal: input.ordinal,
					state: input.captureState,
					payload: input.payload,
					phase: input.capturePhase,
					checkpoint: input.checkpoint,
					inputFingerprint: input.inputFingerprint,
					stagingExecutionId: input.stagingExecutionId ?? null,
				}).pipe(Effect.orDie);
				const [inserted] = yield* database.run((db) =>
					db
						.insert(schema.importItem)
						.values({
							data,
							id: input.id,
							kind: "payload",
							runId: scope.runId,
							recoveryBytes: input.recoveryBytes ?? null,
						})
						.onConflictDoNothing()
						.returning(),
				);
				const stored =
					inserted ??
					(yield* database.run((db) =>
						db
							.select()
							.from(schema.importItem)
							.where(itemOf("payload", scope.runId, input.id)),
					))[0];
				const row = stored ? yield* decodePayloadItem(stored) : null;
				if (
					!row ||
					row.released ||
					row.retiring ||
					row.ordinal !== input.ordinal ||
					row.stagingExecutionId !== (input.stagingExecutionId ?? null) ||
					(input.ordinal === null &&
						stableStringify(row.payload) !== stableStringify(input.payload)) ||
					row.inputFingerprint !== input.inputFingerprint ||
					row.captureState !== input.captureState ||
					row.capturePhase !== input.capturePhase ||
					stableStringify(row.checkpoint) !== stableStringify(input.checkpoint)
				) {
					return yield* new DbError({ message: "Ingestion payload reservation identity changed" });
				}
				return row;
			});
			const listPayloadReservations = Effect.fn("ImportsRepository.listPayloadReservations")(
				function* (input: { userId: UserId; runId?: ImportRunId }) {
					const rows = yield* database.run((db) =>
						db
							.select({ runId: schema.importRun.id, item: schema.importItem })
							.from(schema.importItem)
							.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importItem.runId))
							.where(
								and(
									eq(schema.importItem.kind, "payload"),
									eq(schema.importRun.userId, input.userId),
									input.runId === undefined ? undefined : eq(schema.importRun.id, input.runId),
								),
							),
					);
					return yield* Effect.forEach(rows, (row) =>
						Effect.map(decodePayloadItem(row.item), (reservation) => ({
							reservation,
							runId: row.runId,
						})),
					);
				},
			);
			const getPayloadReservation = Effect.fn("ImportsRepository.getPayloadReservation")(function* (
				scope: IngestionScope,
				id: string,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select({ item: schema.importItem })
						.from(schema.importItem)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importItem.runId))
						.where(and(owned(scope), itemOf("payload", scope.runId, id)))
						.limit(1),
				);
				return row ? yield* decodePayloadItem(row.item) : null;
			});
			const getStagingOwner = Effect.fn("ImportsRepository.getStagingOwner")(function* (
				userId: UserId,
				executionId: string,
			) {
				const [run] = yield* database.run((db) =>
					db
						.select({ id: schema.importRun.id })
						.from(schema.importRun)
						.where(
							and(
								eq(schema.importRun.userId, userId),
								sql`${schema.importRun.pins}->>'executionId' = ${executionId}`,
							),
						)
						.limit(1),
				);
				return run
					? yield* getIngestionRunControl({ userId, runId: ImportRunId.make(run.id) })
					: null;
			});
			const startPayloadWrite = Effect.fn("ImportsRepository.startPayloadWrite")(function* (
				scope: IngestionScope,
				id: string,
			) {
				yield* checkCaptureOwner(scope);
				yield* lockProjection(scope, ["pending", "blocked", "running"]);
				const rows = yield* database.run((db) =>
					db
						.update(schema.importItem)
						.set({ writeStarted: true })
						.where(
							and(
								itemOf("payload", scope.runId, id),
								eq(schema.importItem.retiring, false),
								eq(schema.importItem.released, false),
							),
						)
						.returning({ id: schema.importItem.id }),
				);
				if (rows.length === 0) {
					return yield* new DbError({ message: "Ingestion payload owner is retiring" });
				}
				return yield* Effect.void;
			});
			const stopPayloadWrites = Effect.fn("ImportsRepository.stopPayloadWrites")(function* (input: {
				userId: UserId;
				runId?: ImportRunId;
			}) {
				yield* database.requireTransaction;
				yield* database.acquireUserWriteLock(input.userId);
				yield* database.run((db) =>
					db
						.update(schema.importItem)
						.set({ retiring: true })
						.where(
							and(
								eq(schema.importItem.kind, "payload"),
								sql`exists (select 1 from ${schema.importRun} where ${schema.importRun.id} = ${schema.importItem.runId} and ${schema.importRun.userId} = ${input.userId})`,
								input.runId === undefined ? undefined : eq(schema.importItem.runId, input.runId),
							),
						),
				);
				return yield* listPayloadReservations(input);
			});
			const releasePayloadReservation = Effect.fn("ImportsRepository.releasePayloadReservation")(
				function* (scope: IngestionScope, id: string) {
					yield* database.run((db) =>
						db
							.update(schema.importItem)
							.set({ released: true, recoveryBytes: null })
							.where(
								and(
									itemOf("payload", scope.runId, id),
									sql`exists (select 1 from ${schema.importRun} where ${schema.importRun.id} = ${scope.runId} and ${schema.importRun.userId} = ${scope.userId})`,
								),
							),
					);
				},
			);
			const clearPayloadRecovery = Effect.fn("ImportsRepository.clearPayloadRecovery")(function* (
				scope: IngestionScope,
				id: string,
			) {
				yield* lockProjection(scope, ["pending", "blocked", "running"]);
				const rows = yield* database.run((db) =>
					db
						.update(schema.importItem)
						.set({ recoveryBytes: null })
						.where(and(itemOf("payload", scope.runId, id), eq(schema.importItem.retiring, false)))
						.returning({ id: schema.importItem.id }),
				);
				if (rows.length === 0) {
					return yield* new DbError({ message: "Ingestion payload owner is retiring" });
				}
				return yield* Effect.void;
			});
			/** Whoever deletes a run must first remove its stored payloads, which nothing can find afterwards. */
			const assertPayloadsReleased = Effect.fn("ImportsRepository.assertPayloadsReleased")(
				function* (input: { userId: UserId; runId?: ImportRunId }) {
					const reservations = yield* listPayloadReservations(input);
					if (reservations.some(({ reservation }) => !reservation.released)) {
						return yield* new DbError({ message: "Ingestion payloads are still held" });
					}
					return yield* Effect.void;
				},
			);
			const createBlockedRun = Effect.fn("ImportsRepository.createBlockedRun")(function* (input: {
				userId: UserId;
				acceptedAt: Date;
				source: ImportRunSource;
				integrationId: IntegrationId;
				pluginInstallationId: null | string;
				inputSummary: Record<string, unknown>;
				blockReasons: ReadonlyArray<IngestionBlockReason>;
			}) {
				yield* database.requireTransaction;
				yield* database.acquireUserWriteLock(input.userId);
				yield* assertAdmissionOwner(input);
				const [owner] = yield* database.run((db) =>
					db
						.select({ id: schema.user.id })
						.from(schema.user)
						.where(and(eq(schema.user.id, input.userId), eq(schema.user.id, input.userId)))
						.for("update")
						.limit(1),
				);
				if (!owner) {
					return yield* new DbError({ message: "Blocked ingestion account has retired" });
				}
				const blockReasons = yield* Schema.decodeEffect(Schema.Array(IngestionBlockReason))(
					input.blockReasons,
				);
				const [run] = yield* database.run((db) =>
					db
						.insert(schema.importRun)
						.values({
							...input,
							blockReasons,
							status: "blocked",
							integrationLot: "sink",
							createdAt: input.acceptedAt,
							blockDeadline: DateTime.toDateUtc(
								DateTime.addDuration(
									DateTime.fromDateUnsafe(input.acceptedAt),
									BLOCKED_IMPORT_WINDOW,
								),
							),
						})
						.returning(),
				);
				if (!run) {
					return yield* new DbError({ message: "Blocked run insert returned no row" });
				}
				return ImportRunId.make(run.id);
			});
			const releaseBlocked = Effect.fn("ImportsRepository.releaseBlocked")(function* (input: {
				now: Date;
				plan: IngestionPlan;
				pins: IngestionPins;
				scope: IngestionScope;
			}) {
				const plan = yield* Schema.decodeEffect(IngestionPlan)(input.plan);
				const pins = yield* Schema.decodeEffect(IngestionPins)(input.pins);
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({ plan, pins, blockReasons: [], status: "pending" })
						.where(
							and(
								owned(input.scope),
								eq(schema.importRun.status, "blocked"),
								executableOwner(),
								sql`${schema.importRun.preparedRelease} is null or (${schema.importRun.preparedRelease}->'plan' = ${JSON.stringify(plan)}::jsonb and ${schema.importRun.pins} = ${JSON.stringify(pins)}::jsonb)`,
								sql`${schema.importRun.blockDeadline} > ${input.now}`,
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});
			const expireBlocked = Effect.fn("ImportsRepository.expireBlocked")(function* (input: {
				now: Date;
				scope: IngestionScope;
			}) {
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({
							status: "expired",
							finishedAt: input.now,
							expiryReason: "setup-deadline-expired",
						})
						.where(
							and(
								owned(input.scope),
								eq(schema.importRun.status, "blocked"),
								sql`${schema.importRun.blockDeadline} <= ${input.now}`,
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});
			const rejectBlocked = Effect.fn("ImportsRepository.rejectBlocked")(function* (input: {
				finishedAt: Date;
				scope: IngestionScope;
				failureReason: ImportRunFailureReason;
			}) {
				yield* database.requireTransaction;
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({
							status: "failed",
							finishedAt: input.finishedAt,
							failureReason: input.failureReason,
						})
						.where(and(owned(input.scope), eq(schema.importRun.status, "blocked")))
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});
			const startIngestion = Effect.fn("ImportsRepository.startIngestion")(function* (input: {
				startedAt: Date;
				scope: IngestionScope;
			}) {
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({ status: "running", startedAt: input.startedAt })
						.where(
							and(
								owned(input.scope),
								eq(schema.importRun.status, "pending"),
								executableOwner(),
								sql`${schema.importRun.plan} is not null and ${schema.importRun.pins} is not null`,
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});
			const startIntegrationIngestion = Effect.fn("ImportsRepository.startIntegrationIngestion")(
				function* (input: {
					startedAt: Date;
					scope: IngestionScope;
					integrationId: IntegrationId;
				}) {
					return yield* database.transaction(
						Effect.gen(function* () {
							yield* database.acquireUserWriteLock(input.scope.userId);
							const [active] = yield* database.run((db) =>
								db
									.select({ id: schema.importRun.id })
									.from(schema.importRun)
									.where(
										and(
											eq(schema.importRun.integrationId, input.integrationId),
											eq(schema.importRun.userId, input.scope.userId),
											inArray(schema.importRun.status, ["running", "cancelling"]),
										),
									)
									.limit(1),
							);
							if (active) {
								return active.id === input.scope.runId;
							}
							return yield* startIngestion(input);
						}),
					);
				},
			);
			const publishCapture = Effect.fn("ImportsRepository.publishCapture")(function* (
				scope: IngestionScope,
				capture: IngestionCapture,
			) {
				const data = yield* Schema.decodeEffect(IngestionCapture)(capture);
				yield* checkCaptureOwner(scope);
				const run = yield* lockProjection(scope, ["pending", "blocked", "running"]);
				const [existing] = yield* database.run((db) =>
					db
						.select()
						.from(schema.importItem)
						.where(itemOf("payload", scope.runId, data.id))
						.limit(1),
				);
				if (existing?.published) {
					if (stableStringify(yield* decodeCapture(existing)) !== stableStringify(data)) {
						return yield* new DbError({ message: "Capture identity conflict" });
					}
					return false;
				}
				if (run.collectionSealed && data.phase === "collection") {
					return yield* new DbError({ message: "Collection is sealed" });
				}
				const { payload, state } = data;
				if (payload === null || state === "released") {
					return yield* new DbError({
						message: "Capture publication requires durable payload metadata",
					});
				}
				const item = {
					state,
					payload,
					phase: data.phase,
					ordinal: data.ordinal,
					stagingExecutionId: null,
					checkpoint: data.checkpoint,
					inputFingerprint: payload.checksum,
				};
				yield* database.run((db) =>
					existing
						? db
								.update(schema.importItem)
								.set({ published: true })
								.where(itemOf("payload", scope.runId, data.id))
						: db.insert(schema.importItem).values({
								data: item,
								id: data.id,
								kind: "payload",
								published: true,
								runId: scope.runId,
							}),
				);
				return true;
			});
			const sealCollection = Effect.fn("ImportsRepository.sealCollection")(function* (
				scope: IngestionScope,
			) {
				yield* lockProjection(scope);
				yield* database.run((db) =>
					db.update(schema.importRun).set({ collectionSealed: true }).where(owned(scope)),
				);
			});
			const registerBatch = Effect.fn("ImportsRepository.registerBatch")(function* (
				scope: IngestionScope,
				batch: IngestionBatch,
				operationIds: ReadonlyArray<string>,
			) {
				const data = yield* Schema.decodeEffect(IngestionBatch)(batch);
				yield* lockProjection(scope);
				const [existing] = yield* database.run((db) =>
					db.select().from(schema.importItem).where(itemOf("batch", scope.runId, data.id)).limit(1),
				);
				if (existing) {
					const stored = yield* decodeBatch(existing.data);
					if (
						stableStringify(existing.operationIds) !== stableStringify([...operationIds].sort()) ||
						stored.inputFingerprint !== data.inputFingerprint ||
						stored.captureId !== data.captureId ||
						stored.ordinal !== data.ordinal
					) {
						return yield* new DbError({ message: "Batch identity conflict" });
					}
					return false;
				}
				if (data.state !== "pending" || data.summary.length > 0) {
					return yield* new DbError({ message: "Batch must be registered pending" });
				}
				const captures = yield* database.run((db) =>
					db
						.select({ id: schema.importItem.id })
						.from(schema.importItem)
						.where(and(ownedPublished(scope), eq(schema.importItem.id, data.captureId))),
				);
				if (captures.length === 0) {
					return yield* new DbError({ message: "Batch capture is not published" });
				}
				if (operationIds.length > 1000 || new Set(operationIds).size !== operationIds.length) {
					return yield* new DbError({
						message: "Batch operation identities are not bounded and unique",
					});
				}
				const operationArray = sql`ARRAY[${sql.join(
					operationIds.map((id) => sql`${id}`),
					sql`, `,
				)}]::text[]`;
				const overlaps = yield* database.run((db) =>
					db
						.select({ id: schema.importItem.id })
						.from(schema.importItem)
						.where(
							and(
								itemsOf("batch", scope.runId),
								sql`${schema.importItem.operationIds} && ${operationArray}`,
							),
						)
						.limit(1),
				);
				if (overlaps.length > 0) {
					return yield* new DbError({ message: "Ingestion operation belongs to another batch" });
				}
				yield* database.run((db) =>
					db.insert(schema.importItem).values({
						data,
						id: data.id,
						kind: "batch",
						runId: scope.runId,
						operationIds: [...operationIds].sort(),
					}),
				);
				return true;
			});
			const projectBatch = Effect.fn("ImportsRepository.projectBatch")(function* (
				scope: IngestionScope,
				batch: IngestionBatch,
			) {
				const data = yield* Schema.decodeEffect(IngestionBatch)(batch);
				yield* lockProjection(scope, ["running", "cancelling"]);
				const rows = yield* database.run((db) =>
					db
						.select({ id: schema.importItem.id, data: schema.importItem.data })
						.from(schema.importItem)
						.where(itemsOf("batch", scope.runId)),
				);
				const batches = yield* Effect.forEach(rows, (row) => decodeBatch(row.data));
				const existing = batches.find(({ id }) => id === data.id);
				if (
					!existing ||
					existing.inputFingerprint !== data.inputFingerprint ||
					existing.captureId !== data.captureId ||
					existing.ordinal !== data.ordinal
				) {
					return yield* new DbError({ message: "Batch identity conflict" });
				}
				if (existing.state === "applied") {
					if (stableStringify(existing) !== stableStringify(data)) {
						return yield* new DbError({ message: "Applied batch projection conflict" });
					}
					return false;
				}
				if (data.state !== "applied") {
					return yield* new DbError({ message: "Only confirmed batch summaries may be projected" });
				}
				const dimensions = new Set(
					[...data.summary, ...batches.flatMap((row) => row.summary)].map((row) =>
						stableStringify([row.recordKind, row.unit]),
					),
				);
				if (dimensions.size > 100) {
					return yield* new DbError({ message: "Ingestion summary exceeds its record-kind limit" });
				}
				yield* database.run((db) =>
					db.update(schema.importItem).set({ data }).where(itemOf("batch", scope.runId, data.id)),
				);
				return true;
			});
			const storeBatchResult = Effect.fn("ImportsRepository.storeBatchResult")(function* (
				scope: IngestionScope,
				id: string,
				result: JsonValue,
			) {
				yield* database.run((db) =>
					db.update(schema.importItem).set({ result }).where(itemOf("batch", scope.runId, id)),
				);
			});
			const writeActivity = Effect.fn("ImportsRepository.writeActivity")(function* (
				scope: IngestionScope,
				activity: IngestionActivity,
				statuses: ReadonlyArray<ImportRunRow["status"]>,
			) {
				const data = yield* Schema.decodeEffect(IngestionActivity)(activity);
				yield* lockProjection(scope, statuses);
				if (data.exactTotal !== null && data.completed > data.exactTotal) {
					return yield* new DbError({ message: "Activity exceeds exact total" });
				}
				const [existing] = yield* database.run((db) =>
					db
						.select()
						.from(schema.importActivity)
						.where(
							and(
								eq(schema.importActivity.runId, scope.runId),
								eq(schema.importActivity.id, data.id),
							),
						)
						.limit(1),
				);
				if (
					existing &&
					(existing.data.kind !== data.kind ||
						existing.data.unit !== data.unit ||
						existing.data.parentId !== data.parentId ||
						existing.data.batchId !== data.batchId ||
						existing.data.completed > data.completed ||
						existing.data.lastAdvancedAt > data.lastAdvancedAt ||
						(existing.data.exactTotal !== null && existing.data.exactTotal !== data.exactTotal))
				) {
					return yield* new DbError({ message: "Activity identity or progress conflict" });
				}
				const { batchId } = data;
				if (batchId !== null) {
					const batches = yield* database.run((db) =>
						db
							.select({ id: schema.importItem.id })
							.from(schema.importItem)
							.where(itemOf("batch", scope.runId, batchId)),
					);
					if (batches.length === 0) {
						return yield* new DbError({ message: "Activity batch is unavailable" });
					}
				}
				yield* database.run((db) =>
					db
						.insert(schema.importActivity)
						.values({ data, runId: scope.runId })
						.onConflictDoUpdate({
							set: { data },
							target: [schema.importActivity.runId, schema.importActivity.id],
						}),
				);
				return undefined;
			});
			const putActivity = Effect.fn("ImportsRepository.putActivity")(
				(scope: IngestionScope, activity: IngestionActivity) =>
					writeActivity(scope, activity, ["running"]),
			);
			const putSettlementActivity = Effect.fn("ImportsRepository.putSettlementActivity")(
				(scope: IngestionScope, activity: IngestionActivity) =>
					writeActivity(scope, activity, ["running", "cancelling"]),
			);
			const recordOutcome = Effect.fn("ImportsRepository.recordOutcome")(function* (
				scope: IngestionScope,
				outcome: IngestionOutcome,
			) {
				const data = yield* Schema.decodeEffect(IngestionOutcome)(outcome);
				yield* lockProjection(scope, ["running", "cancelling"]);
				const [existing] = yield* database.run((db) =>
					db
						.select({ data: schema.importItem.data })
						.from(schema.importItem)
						.where(itemOf("outcome", scope.runId, data.operationId))
						.limit(1),
				);
				if (existing) {
					if (stableStringify(existing.data) !== stableStringify(data)) {
						return yield* new DbError({ message: "Operation identity conflict" });
					}
					return false;
				}
				yield* database.run((db) =>
					db
						.insert(schema.importItem)
						.values({ data, kind: "outcome", runId: scope.runId, id: data.operationId }),
				);
				return true;
			});
			const recordIssue = Effect.fn("ImportsRepository.recordIssue")(function* (
				scope: IngestionScope,
				issue: IngestionIssue,
			) {
				const data = yield* Schema.decodeEffect(IngestionIssue)(issue);
				yield* lockProjection(scope, ["running", "cancelling"]);
				const [existing] = yield* database.run((db) =>
					db
						.select()
						.from(schema.importIssue)
						.where(
							and(eq(schema.importIssue.runId, scope.runId), eq(schema.importIssue.id, data.id)),
						)
						.limit(1),
				);
				if (existing) {
					if (stableStringify(existing.data) !== stableStringify(data)) {
						return yield* new DbError({ message: "Issue identity conflict" });
					}
					return false;
				}
				yield* database.run((db) =>
					db.insert(schema.importIssue).values({ data, runId: scope.runId }),
				);
				return true;
			});
			const getIngestionRunControl = Effect.fn("ImportsRepository.getIngestionRunControl")(
				function* (scope: IngestionScope) {
					const [run] = yield* database.run((db) =>
						db
							.select({
								id: schema.importRun.id,
								plan: schema.importRun.plan,
								pins: schema.importRun.pins,
								userId: schema.importRun.userId,
								source: schema.importRun.source,
								status: schema.importRun.status,
								createdAt: schema.importRun.createdAt,
								startedAt: schema.importRun.startedAt,
								finishedAt: schema.importRun.finishedAt,
								blockReasons: schema.importRun.blockReasons,
								expiryReason: schema.importRun.expiryReason,
								failureReason: schema.importRun.failureReason,
								integrationId: schema.importRun.integrationId,
								blockDeadline: schema.importRun.blockDeadline,
								collectionSealed: schema.importRun.collectionSealed,
								pluginInstallationId: schema.importRun.pluginInstallationId,
							})
							.from(schema.importRun)
							.where(owned(scope))
							.limit(1),
					);
					if (!run) {
						return null;
					}
					return yield* Schema.decodeEffect(IngestionRunControl)({
						...run,
						executionKind: executionKind(run),
						acceptedAt: run.createdAt.toISOString(),
						startedAt: run.startedAt?.toISOString() ?? null,
						finishedAt: run.finishedAt?.toISOString() ?? null,
						blockDeadline: run.blockDeadline?.toISOString() ?? null,
					});
				},
			);
			const getIngestionRun = Effect.fn("ImportsRepository.getIngestionRun")(function* (
				scope: IngestionScope,
			) {
				const run = yield* getIngestionRunControl(scope);
				if (!run) {
					return null;
				}
				const batchRows = yield* database.run((db) =>
					db
						.select({ data: schema.importItem.data })
						.from(schema.importItem)
						.where(itemsOf("batch", scope.runId))
						.orderBy(asc(schema.importItem.ordinal)),
				);
				const batches = yield* Effect.forEach(batchRows, (row) => decodeBatch(row.data));
				const activities = yield* database.run((db) =>
					db
						.select()
						.from(schema.importActivity)
						.where(eq(schema.importActivity.runId, scope.runId))
						.orderBy(asc(schema.importActivity.id)),
				);
				const summary: Array<IngestionSummary[number]> = [];
				for (const batch of batches) {
					for (const item of batch.summary) {
						const existing = summary.find(
							(entry) => entry.unit === item.unit && entry.recordKind === item.recordKind,
						);
						if (!existing) {
							summary.push({ ...item, counts: { ...item.counts } });
						} else {
							summary[summary.indexOf(existing)] = {
								...existing,
								counts: {
									created: existing.counts.created + item.counts.created,
									updated: existing.counts.updated + item.counts.updated,
									skipped: existing.counts.skipped + item.counts.skipped,
									unchanged: existing.counts.unchanged + item.counts.unchanged,
									unsuccessful: existing.counts.unsuccessful + item.counts.unsuccessful,
								},
							};
						}
					}
				}
				return yield* Schema.decodeEffect(IngestionRun)({
					...run,
					summary,
					activities: activities.map((activity) => activity.data),
				});
			});
			const cancelIngestion = Effect.fn("ImportsRepository.cancelIngestion")(function* (
				scope: IngestionScope,
			) {
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({ status: "cancelling" })
						.where(
							and(
								owned(scope),
								inArray(schema.importRun.status, ["pending", "blocked", "running"]),
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});
			const pinIngestion = Effect.fn("ImportsRepository.pinIngestion")(function* (input: {
				plan: IngestionPlan;
				pins: IngestionPins;
				scope: IngestionScope;
			}) {
				const plan = yield* Schema.decodeEffect(IngestionPlan)(input.plan);
				const pins = yield* Schema.decodeEffect(IngestionPins)(input.pins);
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({ plan, pins })
						.where(
							and(
								owned(input.scope),
								eq(schema.importRun.status, "pending"),
								isNull(schema.importRun.plan),
								executableOwner(),
								sql`${schema.importRun.preparedRelease} is null or ${schema.importRun.preparedRelease}->'plan' = ${JSON.stringify(plan)}::jsonb`,
								or(
									isNull(schema.importRun.pins),
									sql`${schema.importRun.pins} = ${JSON.stringify(pins)}::jsonb`,
								),
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});
			const startBatch = Effect.fn("ImportsRepository.startBatch")(function* (
				scope: IngestionScope,
				batchId: string,
			) {
				yield* lockProjection(scope);
				const rows = yield* database.run((db) =>
					db
						.update(schema.importItem)
						.set({ data: sql`jsonb_set(${schema.importItem.data}, '{state}', '"applying"'::jsonb)` })
						.where(
							and(
								itemOf("batch", scope.runId, batchId),
								sql`${schema.importItem.data}->>'state' = 'pending'`,
							),
						)
						.returning({ id: schema.importItem.id }),
				);
				return rows.length > 0;
			});
			const settleIngestion = Effect.fn("ImportsRepository.settleIngestion")(function* (input: {
				finishedAt: Date;
				scope: IngestionScope;
				failureReason?: ImportRunFailureReason;
				status: "failed" | "completed" | "cancelled";
			}) {
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({
							status: input.status,
							finishedAt: input.finishedAt,
							failureReason:
								input.failureReason ??
								sql`case when ${schema.importRun.failureReason}->>'code' = 'package-identity-conflict' then ${schema.importRun.failureReason} else null end`,
						})
						.where(
							and(
								owned(input.scope),
								eq(
									schema.importRun.status,
									input.status === "cancelled" ? "cancelling" : "running",
								),
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});
			const finishActivities = Effect.fn("ImportsRepository.finishActivities")(function* (
				scope: IngestionScope,
				status: "failed" | "completed" | "cancelled",
			) {
				const run = yield* lockProjection(scope, [
					"running",
					"cancelling",
					"completed",
					"failed",
					"cancelled",
					"expired",
				]);
				if (["failed", "expired", "completed", "cancelled"].includes(run.status)) {
					return null;
				}
				const state = run.status === "cancelling" ? "cancelled" : status;
				yield* database.run((db) =>
					db
						.update(schema.importActivity)
						.set({
							data: sql`jsonb_set(${schema.importActivity.data}, '{state}', ${JSON.stringify(state)}::jsonb)`,
						})
						.where(
							and(
								eq(schema.importActivity.runId, scope.runId),
								sql`${schema.importActivity.data}->>'state' in ('pending', 'running', 'waiting')`,
							),
						),
				);
				return state;
			});
			const listCaptures = Effect.fn("ImportsRepository.listCaptures")(function* (
				scope: IngestionScope,
			) {
				const rows = yield* database.run((db) =>
					db
						.select({ item: schema.importItem })
						.from(schema.importItem)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importItem.runId))
						.where(and(owned(scope), ownedPublished(scope)))
						.orderBy(asc(schema.importItem.ordinal)),
				);
				return yield* Effect.forEach(rows, (row) =>
					Effect.map(decodeCapture(row.item), (data) => ({ data })),
				);
			});
			const listBatches = Effect.fn("ImportsRepository.listBatches")(function* (
				scope: IngestionScope,
			) {
				const rows = yield* database.run((db) =>
					db
						.select({ data: schema.importItem.data, result: schema.importItem.result })
						.from(schema.importItem)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importItem.runId))
						.where(and(owned(scope), itemsOf("batch", scope.runId)))
						.orderBy(asc(schema.importItem.ordinal)),
				);
				return yield* Effect.forEach(rows, (row) =>
					Effect.map(decodeBatch(row.data), (data) => ({ data, result: row.result })),
				);
			});
			const getBatch = Effect.fn("ImportsRepository.getBatch")(function* (
				scope: IngestionScope,
				id: string,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select({ data: schema.importItem.data })
						.from(schema.importItem)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importItem.runId))
						.where(and(owned(scope), itemOf("batch", scope.runId, id))),
				);
				return row ? yield* decodeBatch(row.data) : null;
			});
			const isIngestionApplied = Effect.fn("ImportsRepository.isIngestionApplied")(function* (
				scope: IngestionScope,
			) {
				const rows = yield* database.run((db) =>
					db
						.select({ id: schema.importRun.id })
						.from(schema.importRun)
						.where(
							and(
								owned(scope),
								eq(schema.importRun.collectionSealed, true),
								sql`not exists (select 1 from ${schema.importItem} r where r.run_id = ${scope.runId} and r.kind = 'payload' and r.ordinal is not null and not r.released and not r.published)`,
								sql`not exists (select 1 from ${schema.importItem} b where b.run_id = ${scope.runId} and b.kind = 'batch' and b.data->>'state' <> 'applied')`,
								sql`not exists (select 1 from ${schema.importItem} c where c.run_id = ${scope.runId} and c.kind = 'payload' and c.published and c.phase = 'application' and not exists (select 1 from ${schema.importItem} b where b.run_id = c.run_id and b.kind = 'batch' and b.capture_id = c.id and b.data->>'state' = 'applied'))`,
							),
						)
						.limit(1),
				);
				return rows.length > 0;
			});
			const getCapture = Effect.fn("ImportsRepository.getCapture")(function* (
				scope: IngestionScope,
				id: string,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select({ item: schema.importItem })
						.from(schema.importItem)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importItem.runId))
						.where(and(owned(scope), ownedPublished(scope), eq(schema.importItem.id, id)))
						.limit(1),
				);
				return row ? yield* decodeCapture(row.item) : null;
			});
			const getIntegrationInput = Effect.fn("ImportsRepository.getIntegrationInput")(function* (
				scope: IngestionScope,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select({ item: schema.importItem, lot: schema.importRun.integrationLot })
						.from(schema.importRun)
						.leftJoin(
							schema.importItem,
							and(ownedPublished(scope), eq(schema.importItem.id, "admitted-envelope")),
						)
						.where(owned(scope))
						.limit(1),
				);
				if (!row) {
					return null;
				}
				return { lot: row.lot, envelope: row.item ? yield* decodeCapture(row.item) : null };
			});
			const pageCaptures = Effect.fn("ImportsRepository.pageCaptures")(function* (
				scope: IngestionScope,
				after: null | number,
				limit: number,
			) {
				const rows = yield* database.run((db) =>
					db
						.select({ item: schema.importItem })
						.from(schema.importItem)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importItem.runId))
						.where(
							and(
								owned(scope),
								ownedPublished(scope),
								sql`${schema.importItem.ordinal} >= 64`,
								eq(schema.importItem.phase, "collection"),
								after === null ? undefined : sql`${schema.importItem.ordinal} > ${after}`,
							),
						)
						.orderBy(asc(schema.importItem.ordinal))
						.limit(Math.min(100, Math.max(1, limit))),
				);
				return yield* Effect.forEach(rows, (row) =>
					Effect.map(decodeCapture(row.item), (data) => ({ data })),
				);
			});
			const listIssues = Effect.fn("ImportsRepository.listIssues")(function* (input: {
				limit: number;
				after?: string;
				scope: IngestionScope;
			}) {
				return yield* database.run((db) =>
					db
						.select({ data: schema.importIssue.data })
						.from(schema.importIssue)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importIssue.runId))
						.where(
							and(
								owned(input.scope),
								input.after === undefined
									? undefined
									: sql`${schema.importIssue.id} > ${input.after}`,
							),
						)
						.orderBy(asc(schema.importIssue.id))
						.limit(Math.min(100, Math.max(1, input.limit))),
				);
			});
			const getBatchIssues = Effect.fn("ImportsRepository.getBatchIssues")(function* (
				scope: IngestionScope,
				batchId: string,
			) {
				return yield* database.run((db) =>
					db
						.select({ data: schema.importIssue.data })
						.from(schema.importIssue)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importIssue.runId))
						.innerJoin(schema.importItem, itemOf("batch", scope.runId, batchId))
						.where(
							and(
								owned(scope),
								sql`${schema.importIssue.id} = any(${schema.importItem.operationIds})`,
							),
						)
						.orderBy(asc(schema.importIssue.id))
						.limit(1000),
				);
			});
			const hasStartedBatch = Effect.fn("ImportsRepository.hasStartedBatch")(function* (
				scope: IngestionScope,
			) {
				const rows = yield* database.run((db) =>
					db
						.select({ id: schema.importItem.id })
						.from(schema.importItem)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importItem.runId))
						.where(
							and(
								owned(scope),
								itemsOf("batch", scope.runId),
								sql`${schema.importItem.data}->>'state' <> 'pending'`,
							),
						)
						.limit(1),
				);
				return rows.length > 0;
			});
			const listRecoveryRuns = Effect.fn("ImportsRepository.listRecoveryRuns")(function* (
				limit: number,
			) {
				return yield* database.run((db) =>
					db
						.select({
							id: schema.importRun.id,
							userId: schema.importRun.userId,
							source: schema.importRun.source,
							status: schema.importRun.status,
							acceptedAt: schema.importRun.createdAt,
							pluginInstallationId: schema.importRun.pluginInstallationId,
							admitted: sql<boolean>`${schema.importRun.plan} is not null and ${schema.importRun.pins} is not null`,
						})
						.from(schema.importRun)
						.innerJoin(schema.user, eq(schema.user.id, schema.importRun.userId))
						.where(
							or(
								and(
									isNull(schema.importRun.integrationId),
									inArray(schema.importRun.status, ["pending", "cancelling"]),
									isNotNull(schema.importRun.plan),
									isNotNull(schema.importRun.pins),
								),
								and(
									isNull(schema.importRun.integrationId),
									inArray(schema.importRun.status, ["pending", "cancelling"]),
									isNull(schema.importRun.plan),
									sql`${schema.importRun.createdAt} < now() - interval '5 minutes'`,
								),
								and(
									inArray(schema.importRun.status, ["completed", "failed", "cancelled", "expired"]),
									or(
										isNotNull(schema.importRun.pins),
										unreleasedPayload(schema.importRun.id),
									),
								),
							),
						)
						.orderBy(asc(schema.importRun.createdAt))
						.limit(Math.min(100, Math.max(1, limit))),
				);
			});
			const captureIntegrationRecoveryCutoff = Effect.fn(
				"ImportsRepository.captureIntegrationRecoveryCutoff",
			)(function* () {
				const [row] = yield* database.run((db) =>
					db.execute<{ cutoff: string }>(
						sql`select to_char(statement_timestamp()::timestamptz(3) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as cutoff`,
						"objects",
					),
				);
				if (!row) {
					return yield* new DbError({ message: "Integration recovery cutoff returned no row" });
				}
				return row.cutoff;
			});
			const listIntegrationRecoveryRuns = Effect.fn(
				"ImportsRepository.listIntegrationRecoveryRuns",
			)(function* (input: { before: Date; limit: number; after: null | IngestionRecoveryCursor }) {
				return yield* database.run((db) =>
					db
						.select({ run: schema.importRun })
						.from(schema.importRun)
						.innerJoin(schema.user, eq(schema.user.id, schema.importRun.userId))
						.where(
							and(
								isNotNull(schema.importRun.integrationId),
								inArray(schema.importRun.status, ["blocked", "pending", "cancelling"]),
								lte(schema.importRun.createdAt, input.before),
								input.after
									? or(
											gt(schema.importRun.createdAt, new Date(input.after.createdAt)),
											and(
												eq(schema.importRun.createdAt, new Date(input.after.createdAt)),
												gt(schema.importRun.id, input.after.id),
											),
										)
									: undefined,
							),
						)
						.orderBy(asc(schema.importRun.createdAt), asc(schema.importRun.id))
						.limit(Math.min(100, Math.max(1, input.limit))),
				);
			});
			const listCleanupPins = Effect.fn("ImportsRepository.listCleanupPins")(function* (input: {
				userId: UserId;
				runId?: ImportRunId;
			}) {
				return yield* database.run((db) =>
					db
						.select({ pins: schema.importRun.pins })
						.from(schema.importRun)
						.where(
							and(
								eq(schema.importRun.userId, input.userId),
								input.runId === undefined ? undefined : eq(schema.importRun.id, input.runId),
								isNotNull(schema.importRun.pins),
							),
						),
				);
			});
			const reserveIngestionPins = Effect.fn("ImportsRepository.reserveIngestionPins")(function* (
				scope: IngestionScope,
				pins: IngestionPins,
				preparedRelease?: PreparedIngestionRelease,
			) {
				const run = yield* lockProjection(scope, ["pending", "blocked"]);
				yield* assertAdmissionOwner({
					userId: scope.userId,
					pluginInstallationId: run.pluginInstallationId,
					integrationId: run.integrationId === null ? null : IntegrationId.make(run.integrationId),
				});
				if (run.pins && stableStringify(run.pins) !== stableStringify(pins)) {
					return yield* new DbError({ message: "Ingestion pin reservation changed" });
				}
				const prepared = preparedRelease
					? yield* Schema.decodeEffect(PreparedIngestionRelease)(preparedRelease)
					: undefined;
				const retained = run.preparedRelease
					? yield* decryptPreparedRelease(scope, run.preparedRelease)
					: null;
				if (run.preparedRelease && stableStringify(retained) !== stableStringify(prepared)) {
					return yield* new DbError({ message: "Ingestion prepared release changed" });
				}
				if (
					prepared &&
					(prepared.state.workflowScriptId !== pins.scriptId ||
						!samePluginPin(prepared.state.pluginRevision, pins))
				) {
					return yield* new DbError({
						message: "Ingestion prepared release does not match retained pins",
					});
				}
				const retainedCiphertext =
					run.preparedRelease ??
					(prepared ? yield* encryptPreparedRelease(scope, prepared) : undefined);
				yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({ pins, ...(retainedCiphertext ? { preparedRelease: retainedCiphertext } : {}) })
						.where(owned(scope)),
				);
				return yield* Effect.void;
			});
			const getPreparedRelease = Effect.fn("ImportsRepository.getPreparedRelease")(function* (
				scope: IngestionScope,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select({ preparedRelease: schema.importRun.preparedRelease })
						.from(schema.importRun)
						.where(owned(scope))
						.limit(1),
				);
				return row?.preparedRelease
					? yield* decryptPreparedRelease(scope, row.preparedRelease)
					: null;
			});
			const retireRuns = Effect.fn("ImportsRepository.retireRuns")(function* (input: {
				userId: UserId;
				integrationId?: IntegrationId;
				pluginInstallationId?: string;
				policy?: PluginIngestionRetirementPolicy;
			}) {
				yield* database.requireTransaction;
				yield* database.acquireUserWriteLock(input.userId);
				const predicate = and(
					eq(schema.importRun.userId, input.userId),
					input.integrationId === undefined
						? undefined
						: eq(schema.importRun.integrationId, input.integrationId),
					input.pluginInstallationId === undefined
						? undefined
						: eq(schema.importRun.pluginInstallationId, input.pluginInstallationId),
					input.policy?.kind === "quarantine"
						? sql`exists (select 1 from ${schema.pluginInstallation} where ${schema.pluginInstallation.id} = ${schema.importRun.pluginInstallationId} and ${schema.pluginInstallation.userId} = ${input.userId} and ${schema.pluginInstallation.pluginId} = ${input.policy.reason.pluginId})`
						: undefined,
				);
				yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({
							status: "cancelling",
							...(input.policy?.kind === "quarantine"
								? { failureReason: input.policy.reason }
								: {}),
						})
						.where(
							and(
								predicate,
								inArray(
									schema.importRun.status,
									input.policy?.kind === "quarantine"
										? ["pending", "blocked", "running", "cancelling"]
										: ["pending", "blocked", "running"],
								),
							),
						),
				);
				const runs = yield* database.run((db) =>
					db
						.select({
							id: schema.importRun.id,
							status: schema.importRun.status,
							integrationId: schema.importRun.integrationId,
							pluginInstallationId: schema.importRun.pluginInstallationId,
						})
						.from(schema.importRun)
						.where(
							and(
								predicate,
								input.policy?.kind === "quarantine"
									? eq(schema.importRun.status, "cancelling")
									: undefined,
							),
						),
				);
				if (input.policy?.kind === "quarantine") {
					for (const run of runs) {
						yield* stopPayloadWrites({ userId: input.userId, runId: ImportRunId.make(run.id) });
					}
				}
				return runs;
			});
			const claimAdmissionAbort = Effect.fn("ImportsRepository.claimAdmissionAbort")(function* (
				scope: IngestionScope,
			) {
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({ status: "cancelling" })
						.where(
							and(
								owned(scope),
								eq(schema.importRun.status, "pending"),
								isNull(schema.importRun.plan),
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});
			const abortAdmission = Effect.fn("ImportsRepository.abortAdmission")(function* (
				scope: IngestionScope,
			) {
				yield* database.requireTransaction;
				const [run] = yield* database.run((db) =>
					db
						.select({ id: schema.importRun.id })
						.from(schema.importRun)
						.where(
							and(
								owned(scope),
								eq(schema.importRun.status, "cancelling"),
								isNull(schema.importRun.plan),
							),
						)
						.for("update"),
				);
				if (!run) {
					return false;
				}
				yield* assertPayloadsReleased(scope);
				yield* database.run((db) =>
					db
						.delete(schema.idempotencyKey)
						.where(
							and(
								eq(schema.idempotencyKey.userId, scope.userId),
								sql`${schema.idempotencyKey.key} like 'data-import:%'`,
								sql`${schema.idempotencyKey.response}->>'runId' = ${scope.runId}`,
							),
						),
				);
				yield* database.run((db) => db.delete(schema.importRun).where(owned(scope)));
				return true;
			});
			const getOutcome = Effect.fn("ImportsRepository.getOutcome")(function* (
				scope: IngestionScope,
				operationId: string,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select({ data: schema.importItem.data })
						.from(schema.importItem)
						.innerJoin(schema.importRun, eq(schema.importRun.id, schema.importItem.runId))
						.where(and(owned(scope), itemOf("outcome", scope.runId, operationId)))
						.limit(1),
				);
				return row ? yield* decodeItem(IngestionOutcome)(row.data) : null;
			});
			const releaseCapture = Effect.fn("ImportsRepository.releaseCapture")(function* (
				scope: IngestionScope,
				captureId: string,
			) {
				const rows = yield* database.run((db) =>
					db
						.update(schema.importItem)
						.set({ captureReleased: true })
						.where(
							and(
								ownedPublished(scope),
								eq(schema.importItem.id, captureId),
								sql`exists (select 1 from ${schema.importRun} where ${owned(scope)} and ${schema.importRun.status} in ('completed', 'failed', 'cancelled', 'expired'))`,
							),
						)
						.returning({ id: schema.importItem.id }),
				);
				return rows.length > 0;
			});
			const releaseIngestionPins = Effect.fn("ImportsRepository.releaseIngestionPins")(function* (
				scope: IngestionScope,
			) {
				const rows = yield* database.run((db) =>
					db
						.update(schema.importRun)
						.set({
							pins: null,
							preparedRelease: null,
							updatedAt: sql`${schema.importRun.updatedAt}`,
						})
						.where(
							and(
								owned(scope),
								inArray(schema.importRun.status, ["completed", "failed", "cancelled", "expired"]),
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});
			const deleteIngestionReport = Effect.fn("ImportsRepository.deleteIngestionReport")(function* (
				scope: IngestionScope,
			) {
				const rows = yield* database.run((db) =>
					db
						.delete(schema.importRun)
						.where(
							and(
								owned(scope),
								inArray(schema.importRun.status, ["completed", "failed", "cancelled", "expired"]),
							),
						)
						.returning({ id: schema.importRun.id }),
				);
				return rows.length > 0;
			});

			return {
				retireRuns,
				getOutcome,
				listIssues,
				getRunById,
				getCapture,
				startBatch,
				getBatch,
				listBatches,
				putActivity,
				recordIssue,
				pinIngestion,
				listCaptures,
				pageCaptures,
				projectBatch,
				recordOutcome,
				registerBatch,
				expireBlocked,
				rejectBlocked,
				deleteRunById,
				abortAdmission,
				getBatchIssues,
				reservePayload,
				releaseCapture,
				publishCapture,
				sealCollection,
				startIngestion,
				releaseBlocked,
				listCleanupPins,
				cancelIngestion,
				settleIngestion,
				getIngestionRun,
				createManualRun,
				getStagingOwner,
				finishActivities,
				listRecoveryRuns,
				createBlockedRun,
				startPayloadWrite,
				stopPayloadWrites,
				getPreparedRelease,
				isIngestionApplied,
				updateInputSummary,
				getIntegrationInput,
				hasStartedBatch,
				storeBatchResult,
				claimAdmissionAbort,
				admitDataSubmission,
				findDataUploadRetry,
				reserveIngestionPins,
				clearPayloadRecovery,
				releaseIngestionPins,
				createIntegrationRun,
				getRunControlForUser,
				putSettlementActivity,
				deleteIngestionReport,
				getPayloadReservation,
				getIngestionRunControl,
				listPayloadReservations,
				assertPayloadsReleased,
				startIntegrationIngestion,
				releasePayloadReservation,
				createIntegrationRunIfIdle,
				listIntegrationRecoveryRuns,
				captureIntegrationRecoveryCutoff,
				listRecentStatusesByIntegrationId,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(PluginConfigEncryptionKey.layer),
	);
}
