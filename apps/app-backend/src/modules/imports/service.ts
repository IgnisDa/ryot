import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	ImportNotFoundError,
	ImportRequestError,
	type CreateImportRunBody,
	type ImportRunFailureReason,
} from "@ryot/contract/modules/imports/schemas";
import type { ImportRunSource } from "@ryot/contract/modules/imports/types";
import type {
	ImportRunId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import type { RunStatus } from "@ryot/contract/schema/run-status";
import { Context, DateTime, Effect, Exit, Result, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import {
	ImportSourceCatalog,
	type RegisteredImportSource,
} from "#modules/plugins/import-source-catalog";
import { UploadIntentsService } from "#modules/uploads/intents/service";

import { ImportRunFailuresService, type ImportRunFailureDetails } from "./failure-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { ImportsRepository } from "./repository";
import { validateFileExtension } from "./runtime/import-files";
import {
	buildImportInputSummary,
	buildImportSourcePayload,
	parseRegistryImportSourceInput,
	registryImportSourceFileInputs,
	registryImportSourceMissingConfigKeys,
	type ImportSourceFileInput,
} from "./runtime/source-metadata";
import { deleteImportSourceState, storeImportSourceState } from "./runtime/source-state-store";
import { ImportWorkflowPinning } from "./workflow-pinning";

export type CreateImportRunInput = {
	userId: UserId;
	source: ImportRunSource;
	integrationId?: IntegrationId | null;
	inputSummary: Record<string, unknown>;
};

export type UpdateImportRunInput = {
	startedAt?: Date;
	finishedAt?: Date;
	progress?: number;
	status?: RunStatus;
	runId: ImportRunId;
	totalItems?: number;
	failedItems?: number;
	importedItems?: number;
	processedItems?: number;
	inputSummary?: Record<string, unknown>;
	failureReason?: ImportRunFailureReason;
};

export type DeleteImportRunInput = { userId: UserId; runId: ImportRunId };

const isTerminalStatus = (status: RunStatus): boolean =>
	status === "completed" || status === "failed";

export class ImportsService extends Context.Service<ImportsService>()("ImportsService", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;
		const engine = yield* WorkflowEngine;
		const uploads = yield* UploadIntentsService;
		const repository = yield* ImportsRepository;
		const importSources = yield* ImportSourceCatalog;
		const workflowPinning = yield* ImportWorkflowPinning;
		const failureService = yield* ImportRunFailuresService;

		const create = Effect.fn("ImportsService.create")(function* (input: CreateImportRunInput) {
			return yield* repository.createRun(input);
		});

		const update = Effect.fn("ImportsService.update")(function* (input: UpdateImportRunInput) {
			yield* repository.updateRun(input);
		});

		const deleteRun = Effect.fn("ImportsService.delete")(function* (input: DeleteImportRunInput) {
			yield* repository.deleteRunById(input);
		});

		const failRun = (runId: ImportRunId, failureReason: ImportRunFailureReason) =>
			Effect.gen(function* () {
				const finishedAt = yield* DateTime.nowAsDate;
				yield* update({ runId, failureReason, status: "failed", finishedAt });
			});

		const cleanupUploads = (intentIds: ReadonlyArray<string>) =>
			Effect.forEach(
				new Set(intentIds),
				(intentId) => uploads.deleteTemporaryUpload(intentId).pipe(Effect.ignore),
				{ discard: true },
			);
		const cleanupSourceState = (stateId: string) =>
			deleteImportSourceState(stateId).pipe(
				Effect.provideService(RedisService, redis),
				Effect.catchCause((cause) =>
					Effect.logWarning("failed to clean up import source state", cause),
				),
			);

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
			const created = yield* create({
				userId: user.id,
				source: body.source,
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

			const summarized = yield* update({
				runId: run.id,
				inputSummary: buildImportInputSummary(body.source, fileNames),
			}).pipe(Effect.result);
			if (Result.isFailure(summarized)) {
				yield* cleanupUploads(claimedUploadIntentIds);
				yield* deleteRun({ runId: run.id, userId: user.id }).pipe(Effect.ignore);
				return yield* summarized.failure;
			}
			const sandboxExecutionId = `${run.id}-import`;
			const pin = yield* workflowPinning
				.preRegister({
					executingUserId: user.id,
					scriptId: workflowScriptId,
					executionId: sandboxExecutionId,
					pluginSlug: registered.pluginSlug,
				})
				.pipe(Effect.result);
			if (Result.isFailure(pin)) {
				yield* cleanupUploads(claimedUploadIntentIds);
				yield* Effect.logError("import workflow pinning failed", pin.failure);
				yield* failRun(run.id, { code: "queue-unavailable", operation: "workflow-pin" });
				return yield* new ImportRequestError({
					reason: { code: "queue-unavailable", operation: "import-run" },
				});
			}
			const stored = yield* storeImportSourceState({
				stateId: run.id,
				state: {
					sourcePayload,
					workflowScriptId,
					namedArtifactPaths,
					source: body.source,
					pluginSlug: registered.pluginSlug,
					uploadIntentIds: claimedUploadIntentIds,
				},
			}).pipe(Effect.provideService(RedisService, redis), Effect.exit);
			if (Exit.isFailure(stored)) {
				yield* cleanupUploads(claimedUploadIntentIds);
				yield* cleanupSourceState(run.id);
				if (pin.success.registrationStatus === "registered") {
					yield* workflowPinning.release(sandboxExecutionId);
				}
				yield* Effect.logError("import source state queue failed", stored.cause);
				yield* failRun(run.id, { code: "queue-unavailable", operation: "source-state" });
				return yield* new ImportRequestError({
					reason: { code: "queue-unavailable", operation: "import-run" },
				});
			}

			const started = yield* engine
				.execute(ProcessImportRunWorkflow, {
					discard: true,
					executionId: run.id,
					payload: { runId: run.id, userId: user.id, sourceStateId: run.id },
				})
				.pipe(Effect.result);
			if (Result.isFailure(started)) {
				yield* cleanupUploads(claimedUploadIntentIds);
				yield* cleanupSourceState(run.id);
				if (pin.success.registrationStatus === "registered") {
					yield* workflowPinning.release(sandboxExecutionId);
				}
				yield* Effect.logError("import workflow enqueue failed", started.failure);
				yield* failRun(run.id, { code: "queue-unavailable", operation: "workflow" });
				return yield* new ImportRequestError({
					reason: { code: "queue-unavailable", operation: "import-run" },
				});
			}

			return { id: run.id };
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
				const run = yield* create({ inputSummary, userId: user.id, source: body.source });
				const sandboxExecutionId = `${run.id}-import`;

				const pin = yield* workflowPinning
					.preRegister({
						executingUserId: user.id,
						scriptId: workflowScriptId,
						executionId: sandboxExecutionId,
						pluginSlug: registered.pluginSlug,
					})
					.pipe(Effect.result);
				if (Result.isFailure(pin)) {
					yield* Effect.logError("import workflow pinning failed", pin.failure);
					yield* failRun(run.id, { code: "queue-unavailable", operation: "workflow-pin" });
					return yield* new ImportRequestError({
						reason: { code: "queue-unavailable", operation: "import-run" },
					});
				}
				const stored = yield* storeImportSourceState({
					stateId: run.id,
					state: {
						sourcePayload,
						workflowScriptId,
						source: body.source,
						uploadIntentIds: [],
						namedArtifactPaths: {},
						pluginSlug: registered.pluginSlug,
					},
				}).pipe(Effect.provideService(RedisService, redis), Effect.exit);
				if (Exit.isFailure(stored)) {
					yield* cleanupSourceState(run.id);
					if (pin.success.registrationStatus === "registered") {
						yield* workflowPinning.release(sandboxExecutionId);
					}
					yield* Effect.logError("import source state queue failed", stored.cause);
					yield* failRun(run.id, { code: "queue-unavailable", operation: "source-state" });
					return yield* new ImportRequestError({
						reason: { code: "queue-unavailable", operation: "import-run" },
					});
				}

				const started = yield* engine
					.execute(ProcessImportRunWorkflow, {
						discard: true,
						executionId: run.id,
						payload: { runId: run.id, userId: user.id, sourceStateId: run.id },
					})
					.pipe(Effect.result);
				if (Result.isFailure(started)) {
					if (pin.success.registrationStatus === "registered") {
						yield* workflowPinning.release(sandboxExecutionId);
					}
					yield* cleanupSourceState(run.id);
					yield* Effect.logError("import workflow enqueue failed", started.failure);
					yield* failRun(run.id, { code: "queue-unavailable", operation: "workflow" });
					return yield* new ImportRequestError({
						reason: { code: "queue-unavailable", operation: "import-run" },
					});
				}

				return { id: run.id };
			},
		);

		const startImportRun = Effect.fn("ImportsService.startImportRun")(function* (
			user: CurrentUserValue,
			body: CreateImportRunBody,
		) {
			const resolution = importSources.resolve(body.source);
			if (!resolution) {
				return yield* new ImportRequestError({
					reason: { code: "source-not-found", source: body.source },
				});
			}
			const registered = resolution.source;
			const workflowScript = yield* resolution.script;
			if (!workflowScript) {
				return yield* new ImportRequestError({
					reason: { code: "workflow-unavailable", source: body.source },
				});
			}
			const missingConfigKeys = yield* registryImportSourceMissingConfigKeys(registered);
			if (missingConfigKeys.length > 0) {
				return yield* new ImportRequestError({
					reason: { missingConfigKeys, source: body.source, code: "source-not-configured" },
				});
			}
			const properties = yield* parseRegistryImportSourceInput(registered, body).pipe(
				Effect.tapError((cause) => Effect.logWarning("invalid import source input", cause)),
				Effect.mapError(
					() => new ImportRequestError({ reason: { code: "invalid-input", field: null } }),
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

		const listImportSources = Effect.fn("ImportsService.listImportSources")(function* () {
			const sources = yield* importSources.listWithWorkflowStatus;
			return yield* Effect.forEach(sources, ({ source, hasActiveWorkflow }) =>
				Effect.gen(function* () {
					const missingPluginConfigKeys = yield* registryImportSourceMissingConfigKeys(source);
					const { configSchema: _configSchema, pluginSlug, ...manifestSource } = source;
					return {
						...manifestSource,
						pluginSlug,
						missingPluginConfigKeys,
						isStartable: hasActiveWorkflow && missingPluginConfigKeys.length === 0,
					};
				}),
			);
		});

		const requireImportRun = Effect.fn("ImportsService.requireImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
		) {
			const run = yield* repository.getRunById({ runId, userId: user.id });
			if (!run) {
				return yield* new ImportNotFoundError({ reason: { code: "run-not-found", runId } });
			}

			return run;
		});

		const removeImportRun = Effect.fn("ImportsService.removeImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
		) {
			const run = yield* requireImportRun(user, runId);
			if (!isTerminalStatus(run.status)) {
				return yield* new ImportRequestError({
					reason: { code: "run-not-terminal", runId, status: run.status },
				});
			}
			yield* deleteRun({ runId, userId: user.id });
			return { id: runId };
		});

		const hasActiveRunForIntegration = (input: { integrationId: IntegrationId }) =>
			repository.hasActiveRunForIntegration(input);

		const createRunForIntegration = (input: {
			userId: UserId;
			source: ImportRunSource;
			integrationId: IntegrationId;
			inputSummary: Record<string, unknown>;
		}) => create(input);

		const failRunForIntegration = Effect.fn("ImportsService.failRunForIntegration")(function* (
			runId: ImportRunId,
			reason: ImportRunFailureReason,
		) {
			const failure: ImportRunFailureDetails = { reason, itemIndex: 0, stage: "source_fetch" };
			yield* failureService.create({ ...failure, runId });
			const finishedAt = yield* DateTime.nowAsDate;
			yield* update({
				runId,
				finishedAt,
				progress: 100,
				totalItems: 1,
				failedItems: 1,
				status: "failed",
				processedItems: 1,
				failureReason: reason,
			});
		});

		return {
			create,
			update,
			startImportRun,
			removeImportRun,
			delete: deleteRun,
			listImportSources,
			failRunForIntegration,
			createRunForIntegration,
			hasActiveRunForIntegration,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
