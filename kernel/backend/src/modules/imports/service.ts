import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { DbError } from "@ryot-app/contract/errors";
import { dataJsonSource } from "@ryot-app/contract/modules/imports/data-json";
import {
	ImportConflictError,
	ImportNotFoundError,
	ImportRequestError,
	ImportRunFailureSchema,
	type CreateImportRunBody,
	type ImportRunFailureReason,
	type ImportRunStatus,
} from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunSource } from "@ryot-app/contract/modules/imports/types";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import {
	AutomationExecutionId,
	type ImportRunId,
	type IntegrationId,
	type SandboxScriptId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, Exit, Layer, Result, Schema, Stream } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import type { ImportSourceState } from "#lib/infrastructure/redis";
import {
	ImportSourceCatalog,
	type RegisteredImportSource,
} from "#modules/plugins/import-source-catalog";
import { UploadIntentsService } from "#modules/uploads/intents/service";

import { DataImportAdmission } from "./data-admission";
import { ImportRunFailuresService, type ImportRunFailureDetails } from "./failure-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { ImportsRepository, type ImportRunFailureCursor } from "./repository";
import { validateFileExtension } from "./runtime/import-files";
import {
	buildImportInputSummary,
	buildImportSourcePayload,
	parseRegistryImportSourceInput,
	registryImportSourceFileInputs,
	registryImportSourceMissingConfigKeys,
	type ImportSourceFileInput,
} from "./runtime/source-metadata";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportWorkflowPinning } from "./workflow-pinning";

export type CreateManualImportRunInput = {
	userId: UserId;
	source: ImportRunSource;
	pluginInstallationId: string | null;
	inputSummary: Record<string, unknown>;
};

export type UpdateImportRunProgressInput = {
	progress?: number;
	runId: ImportRunId;
	totalItems?: number;
	failedItems?: number;
	importedItems?: number;
	processedItems?: number;
};

export type DeleteImportRunInput = { userId: UserId; runId: ImportRunId };

type DispatchImportRunInput = {
	runId: ImportRunId;
	user: CurrentUserValue;
	source: ImportRunSource;
	workflowScriptId: SandboxScriptId;
	registered: RegisteredImportSource;
	sourcePayload: ImportSourceState["sourcePayload"];
	uploadIntentIds: ImportSourceState["uploadIntentIds"];
	namedArtifactPaths: ImportSourceState["namedArtifactPaths"];
};

const isTerminalStatus = (status: ImportRunStatus): boolean =>
	status === "completed" || status === "failed" || status === "cancelled";

const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.String));
const encodeImportRunFailure = Schema.encodeSync(Schema.fromJsonString(ImportRunFailureSchema));

export class ImportsService extends Context.Service<ImportsService>()("ImportsService", {
	make: Effect.gen(function* () {
		const sourceStates = yield* ImportSourceStateStore;
		const engine = yield* WorkflowEngine;
		const uploads = yield* UploadIntentsService;
		const repository = yield* ImportsRepository;
		const importSources = yield* ImportSourceCatalog;
		const workflowPinning = yield* ImportWorkflowPinning;
		const failureService = yield* ImportRunFailuresService;
		const dataAdmission = yield* DataImportAdmission;

		const createManualRun = Effect.fn("ImportsService.createManualRun")(function* (
			input: CreateManualImportRunInput,
		) {
			return yield* repository.createManualRun(input);
		});

		const updateInputSummary = repository.updateInputSummary;
		const markStarted = repository.markStarted;
		const updateProgress = repository.updateProgress;
		const finishCompleted = repository.finishCompleted;
		const finishFailed = repository.finishFailed;
		const finishCancelled = repository.finishCancelled;
		const getRunControlForUser = repository.getRunControlForUser;

		const deleteRun = Effect.fn("ImportsService.delete")(function* (input: DeleteImportRunInput) {
			yield* repository.deleteRunById(input);
		});

		const failRun = (runId: ImportRunId, failureReason: ImportRunFailureReason) =>
			Effect.gen(function* () {
				const finishedAt = yield* DateTime.nowAsDate;
				yield* finishFailed({ runId, finishedAt, failureReason });
			});

		const cleanupUploads = (intentIds: ReadonlyArray<string>) =>
			Effect.forEach(
				new Set(intentIds),
				(intentId) => uploads.deleteTemporaryUpload(intentId).pipe(Effect.ignore),
				{ discard: true },
			);
		const cleanupSourceState = (stateId: string) =>
			sourceStates
				.remove(stateId)
				.pipe(
					Effect.catchCause((cause) =>
						Effect.logWarning("failed to clean up import source state", cause),
					),
				);

		const dispatchImportRun = Effect.fn("ImportsService.dispatchImportRun")(function* (
			input: DispatchImportRunInput,
		) {
			const { user, runId, uploadIntentIds } = input;
			const sandboxExecutionId = `${runId}-import`;
			const command = rootLifecycleCommand({
				source: "import",
				importRunId: runId,
				initiator: { id: user.id, kind: "user" },
				executionId: AutomationExecutionId.make(runId),
				itemIdentity: stableStringify(["import-run", runId]),
				occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
			});
			const failDispatch = Effect.fn("ImportsService.failDispatch")(function* (
				operation: string,
				cause: unknown,
			) {
				yield* Effect.logError(`import dispatch failed at ${operation}`, cause);
				yield* failRun(runId, { operation, code: "queue-unavailable" });
				return yield* new ImportRequestError({
					reason: { operation: "import-run", code: "queue-unavailable" },
				});
			});

			const pin = yield* workflowPinning
				.preRegister({
					executingUserId: user.id,
					executionId: sandboxExecutionId,
					scriptId: input.workflowScriptId,
					pluginId: input.registered.pluginId,
				})
				.pipe(Effect.result);
			if (Result.isFailure(pin)) {
				yield* cleanupUploads(uploadIntentIds);
				return yield* failDispatch("workflow-pin", pin.failure);
			}

			const rollback = Effect.gen(function* () {
				yield* cleanupUploads(uploadIntentIds);
				yield* cleanupSourceState(runId);
				if (pin.success.registrationStatus === "registered") {
					yield* workflowPinning.release(sandboxExecutionId);
				}
			});

			const stored = yield* sourceStates
				.store({
					stateId: runId,
					state: {
						uploadIntentIds,
						source: input.source,
						sourcePayload: input.sourcePayload,
						pluginId: input.registered.pluginId,
						workflowScriptId: input.workflowScriptId,
						pluginRevision: pin.success.pluginRevision,
						namedArtifactPaths: input.namedArtifactPaths,
						pluginInstallationId: input.registered.installationId,
					},
				})
				.pipe(Effect.exit);
			if (Exit.isFailure(stored)) {
				yield* rollback;
				return yield* failDispatch("source-state", stored.cause);
			}

			const started = yield* engine
				.execute(ProcessImportRunWorkflow, {
					discard: true,
					executionId: runId,
					payload: { runId, command, userId: user.id, uploadIntentIds, sourceStateId: runId },
				})
				.pipe(Effect.result);
			if (Result.isFailure(started)) {
				yield* rollback;
				return yield* failDispatch("workflow", started.failure);
			}

			return { id: runId };
		});

		const startFileImportRun = Effect.fn("ImportsService.startFileImportRun")(function* (
			user: CurrentUserValue,
			body: CreateImportRunBody,
			properties: Readonly<Record<string, unknown>>,
			sourceFileInputs: ReadonlyArray<ImportSourceFileInput>,
			registered: RegisteredImportSource,
			workflowScriptId: SandboxScriptId,
		) {
			const fileNames: Record<string, string> = {};
			const claimedUploadIntentIds: string[] = [];
			const namedArtifactPaths: Record<string, string> = {};
			const sourcePayload = buildImportSourcePayload(properties, registered) ?? {};
			const created = yield* createManualRun({
				userId: user.id,
				source: body.source,
				pluginInstallationId: registered.installationId,
				inputSummary: buildImportInputSummary(body.source, {}),
			}).pipe(Effect.result);
			if (Result.isFailure(created)) {
				return yield* created.failure;
			}
			const run = created.success;

			for (const sourceFileInput of sourceFileInputs) {
				const claim = yield* uploads
					.claimTemporaryUpload(sourceFileInput.uploadToken, user.id, run.id)
					.pipe(Effect.result);
				if (Result.isFailure(claim)) {
					yield* cleanupUploads(claimedUploadIntentIds);
					yield* deleteRun({ runId: run.id, userId: user.id }).pipe(Effect.ignore);
					return yield* new ImportRequestError({
						reason: { code: "upload-unavailable", field: sourceFileInput.key },
					});
				}
				claimedUploadIntentIds.push(claim.success.intentId);
				if (claim.success.locator.type !== "local" || !claim.success.resolvedPath) {
					yield* cleanupUploads(claimedUploadIntentIds);
					yield* deleteRun({ runId: run.id, userId: user.id }).pipe(Effect.ignore);
					return yield* new ImportRequestError({
						reason: { code: "upload-unavailable", field: sourceFileInput.key },
					});
				}

				const safePath = claim.success.resolvedPath;

				yield* validateFileExtension(
					claim.success.fileName,
					sourceFileInput.allowedExtensions,
				).pipe(
					Effect.catch(() =>
						cleanupUploads(claimedUploadIntentIds).pipe(
							Effect.andThen(deleteRun({ runId: run.id, userId: user.id }).pipe(Effect.ignore)),
							Effect.flatMap(
								() =>
									new ImportRequestError({
										reason: {
											code: "unsupported-file-extension",
											allowedExtensions: sourceFileInput.allowedExtensions,
										},
									}),
							),
						),
					),
				);

				fileNames[sourceFileInput.key] = claim.success.fileName;
				namedArtifactPaths[sourceFileInput.key] = safePath;
			}

			const summarized = yield* updateInputSummary({
				runId: run.id,
				inputSummary: buildImportInputSummary(body.source, fileNames),
			}).pipe(Effect.result);
			if (Result.isFailure(summarized)) {
				yield* cleanupUploads(claimedUploadIntentIds);
				yield* deleteRun({ runId: run.id, userId: user.id }).pipe(Effect.ignore);
				return yield* summarized.failure;
			}
			return yield* dispatchImportRun({
				user,
				registered,
				runId: run.id,
				sourcePayload,
				workflowScriptId,
				namedArtifactPaths,
				source: body.source,
				uploadIntentIds: claimedUploadIntentIds,
			});
		});

		const startSourcePayloadImportRun = Effect.fn("ImportsService.startSourcePayloadImportRun")(
			function* (
				user: CurrentUserValue,
				body: CreateImportRunBody,
				properties: Readonly<Record<string, unknown>>,
				registered: RegisteredImportSource,
				workflowScriptId: SandboxScriptId,
			) {
				const inputSummary = buildImportInputSummary(body.source, {});
				const sourcePayload = buildImportSourcePayload(properties, registered) ?? {};
				const run = yield* createManualRun({
					inputSummary,
					userId: user.id,
					source: body.source,
					pluginInstallationId: registered.installationId,
				});
				return yield* dispatchImportRun({
					user,
					registered,
					runId: run.id,
					sourcePayload,
					workflowScriptId,
					uploadIntentIds: [],
					source: body.source,
					namedArtifactPaths: {},
				});
			},
		);

		const startImportRun = Effect.fn("ImportsService.startImportRun")(function* (
			user: CurrentUserValue,
			body: CreateImportRunBody,
		) {
			if (body.source === dataJsonSource) {
				return yield* dataAdmission.startUpload(user, body);
			}
			const resolution = yield* importSources.resolveForUser(user.id, body.source);
			if (!resolution) {
				return yield* new ImportRequestError({
					reason: { source: body.source, code: "source-not-found" },
				});
			}
			const registered = resolution.source;
			const workflowScript = resolution.script;
			if (!workflowScript) {
				return yield* new ImportRequestError({
					reason: { source: body.source, code: "workflow-unavailable" },
				});
			}
			const missingConfigKeys = registryImportSourceMissingConfigKeys(registered);
			if (missingConfigKeys.length > 0) {
				return yield* new ImportRequestError({
					reason: { missingConfigKeys, source: body.source, code: "source-not-configured" },
				});
			}
			const properties = yield* parseRegistryImportSourceInput(registered, body).pipe(
				Effect.tapError((cause) => Effect.logWarning("invalid import source input", cause)),
				Effect.mapError(
					() => new ImportRequestError({ reason: { field: null, code: "invalid-input" } }),
				),
			);
			const sourceFileInputs = registryImportSourceFileInputs(registered, properties);

			return sourceFileInputs.length > 0
				? yield* startFileImportRun(
						user,
						body,
						properties,
						sourceFileInputs,
						registered,
						workflowScript.id,
					)
				: yield* startSourcePayloadImportRun(user, body, properties, registered, workflowScript.id);
		});

		const requireImportRun = Effect.fn("ImportsService.requireImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
		) {
			const run = yield* repository.getRunById({ runId, userId: user.id });
			if (!run) {
				return yield* new ImportNotFoundError({ reason: { runId, code: "run-not-found" } });
			}

			return run;
		});

		const removeImportRun = Effect.fn("ImportsService.removeImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
		) {
			const run = yield* requireImportRun(user, runId);
			if (!isTerminalStatus(run.status)) {
				return yield* new ImportConflictError({
					reason: { runId, status: run.status, code: "run-not-terminal" },
				});
			}
			yield* deleteRun({ runId, userId: user.id });
			return { id: runId };
		});

		const downloadFailures = Effect.fn("ImportsService.downloadFailures")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
		) {
			const run = yield* requireImportRun(user, runId);
			const encoder = new TextEncoder();
			const failureStream = (after?: ImportRunFailureCursor): Stream.Stream<Uint8Array, DbError> =>
				Stream.fromEffect(repository.listRunFailurePage({ runId, after, limit: 100 })).pipe(
					Stream.flatMap(({ items, nextCursor }) =>
						Stream.fromIterable(
							items.map((failure, index) =>
								encoder.encode(
									`${after === undefined && index === 0 ? "" : ","}${encodeImportRunFailure(failure)}`,
								),
							),
						).pipe(Stream.concat(nextCursor === null ? Stream.empty : failureStream(nextCursor))),
					),
				);

			const stream = Stream.fromIterable([
				encoder.encode(
					`{"runId":${encodeJsonString(run.id)},"source":${encodeJsonString(run.source)},"failures":[`,
				),
			]).pipe(
				Stream.concat(failureStream()),
				Stream.concat(Stream.fromIterable([encoder.encode("]}")])),
			);
			return { stream, fileName: `ryot-import-failures-${run.id}.json` };
		});

		const createIntegrationRun = (input: {
			userId: UserId;
			source: ImportRunSource;
			integrationId: IntegrationId;
			pluginInstallationId: string | null;
			integrationLot: IntegrationLot;
			inputSummary: Record<string, unknown>;
		}) => repository.createIntegrationRun(input);

		const createIntegrationRunIfIdle = (input: {
			userId: UserId;
			source: ImportRunSource;
			integrationId: IntegrationId;
			pluginInstallationId: string;
			inputSummary: Record<string, unknown>;
		}) => repository.createIntegrationRunIfIdle(input);

		const failRunForIntegration = Effect.fn("ImportsService.failRunForIntegration")(function* (
			runId: ImportRunId,
			reason: ImportRunFailureReason,
		) {
			const failure: ImportRunFailureDetails = { reason, itemIndex: 0, stage: "source_fetch" };
			yield* failureService.create({ ...failure, runId });
			const finishedAt = yield* DateTime.nowAsDate;
			yield* finishFailed({
				runId,
				finishedAt,
				progress: 100,
				totalItems: 1,
				failedItems: 1,
				processedItems: 1,
				failureReason: reason,
			});
		});

		const settleIntegrationDispatchFailure = Effect.fn(
			"ImportsService.settleIntegrationDispatchFailure",
		)(function* (input: { userId: UserId; runId: ImportRunId }) {
			const run = yield* getRunControlForUser(input);
			if (!run || isTerminalStatus(run.status)) {
				return;
			}
			const finishedAt = yield* DateTime.nowAsDate;
			if (run.status === "cancelling") {
				yield* finishCancelled({ finishedAt, runId: input.runId });
				return;
			}
			yield* finishFailed({
				finishedAt,
				runId: input.runId,
				failureReason: { code: "queue-unavailable", operation: "integration-sync" },
			});
		});

		return {
			markStarted,
			finishFailed,
			updateProgress,
			startImportRun,
			finishCompleted,
			finishCancelled,
			createManualRun,
			removeImportRun,
			downloadFailures,
			delete: deleteRun,
			updateInputSummary,
			getRunControlForUser,
			createIntegrationRun,
			failRunForIntegration,
			createIntegrationRunIfIdle,
			settleIntegrationDispatchFailure,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
