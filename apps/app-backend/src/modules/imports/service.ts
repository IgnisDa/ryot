import { FileSystem } from "@effect/platform";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type { CreateImportRunBody } from "@ryot/contract/modules/imports/schemas";
import type { ImportRunSource, ImportRunStatus } from "@ryot/contract/modules/imports/types";
import type {
	ImportRunId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { DateTime, Effect, Either } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import {
	ImportSourceCatalog,
	type RegisteredImportSource,
} from "#modules/plugins/import-source-catalog";
import { UploadsService } from "#modules/uploads/service";

import { ImportRunFailuresService, type ImportRunFailureDetails } from "./failure-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { ImportsRepository } from "./repository";
import {
	cleanupImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./runtime/import-files";
import {
	buildImportInputSummary,
	buildImportSourcePayload,
	registryImportSourceFileInputs,
	registryImportSourceInputError,
	registryImportSourceStartError,
	type ImportSourceFileInput,
} from "./runtime/source-metadata";
import {
	deleteImportSourcePayload,
	storeImportSourcePayload,
} from "./runtime/source-payload-store";
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
	runId: ImportRunId;
	totalItems?: number;
	failedItems?: number;
	errorSummary?: string;
	importedItems?: number;
	processedItems?: number;
	status?: ImportRunStatus;
};

export type DeleteImportRunInput = {
	runId: ImportRunId;
	userId: UserId;
};

const isTerminalStatus = (status: ImportRunStatus): boolean =>
	status === "completed" || status === "failed";

export class ImportsService extends Effect.Service<ImportsService>()("ImportsService", {
	effect: Effect.gen(function* () {
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const uploads = yield* UploadsService;
		const fs = yield* FileSystem.FileSystem;
		const repository = yield* ImportsRepository;
		const importSources = yield* ImportSourceCatalog;
		const workflowPinning = yield* ImportWorkflowPinning;
		const failureService = yield* ImportRunFailuresService;

		const create = Effect.fn("ImportsService.create")(function* (input: CreateImportRunInput) {
			return yield* runWithDb(repository.createRun(input));
		});

		const update = Effect.fn("ImportsService.update")(function* (input: UpdateImportRunInput) {
			yield* runWithDb(repository.updateRun(input));
		});

		const deleteRun = Effect.fn("ImportsService.delete")(function* (input: DeleteImportRunInput) {
			yield* runWithDb(repository.deleteRunById(input));
		});

		const failRun = (runId: ImportRunId, errorSummary: string) =>
			Effect.gen(function* () {
				const finishedAt = yield* DateTime.nowAsDate;
				yield* update({ runId, errorSummary, status: "failed", finishedAt });
			});

		const cleanupFiles = (paths: ReadonlyArray<string>) =>
			Effect.forEach(
				new Set(paths),
				(path) => cleanupImportFile(path).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
				{ discard: true },
			);

		const startFileImportRun = Effect.fn("ImportsService.startFileImportRun")(function* (
			user: CurrentUserValue,
			body: CreateImportRunBody,
			inputSummary: Record<string, unknown>,
			sourceFileInputs: ReadonlyArray<ImportSourceFileInput>,
			registered: RegisteredImportSource,
			workflowScriptId: SandboxScriptId,
		) {
			const tempDir = config.tmpDir;
			const queuedFilePaths: string[] = [];
			const claimedFilePaths: string[] = [];
			const namedArtifactPaths: Record<string, string> = {};

			const sourcePayload = buildImportSourcePayload(body, registered) ?? {};

			for (const sourceFileInput of sourceFileInputs) {
				if (!sourceFileInput.uploadToken) {
					if (sourceFileInput.required === false) {
						continue;
					}
					yield* cleanupFiles(claimedFilePaths);
					return yield* badRequest("Import source requires an upload token");
				}

				const claim = yield* uploads
					.claimUploadToken(sourceFileInput.uploadToken, user.id)
					.pipe(Effect.either);
				if (Either.isLeft(claim)) {
					yield* cleanupFiles(claimedFilePaths);
					return yield* claim.left;
				}
				claimedFilePaths.push(claim.right.resolvedPath);

				const safePath = yield* resolveSafeImportFilePath(claim.right.resolvedPath, tempDir).pipe(
					Effect.catchAll((message) =>
						cleanupFiles(claimedFilePaths).pipe(Effect.flatMap(() => badRequest(message))),
					),
				);
				claimedFilePaths[claimedFilePaths.length - 1] = safePath;

				yield* validateFileExtension(safePath, sourceFileInput.allowedExtensions).pipe(
					Effect.catchAll((message) =>
						cleanupFiles(claimedFilePaths).pipe(Effect.flatMap(() => badRequest(message))),
					),
				);

				queuedFilePaths.push(safePath);
				if (sourceFileInput.payloadKey) {
					sourcePayload[sourceFileInput.payloadKey] = safePath;
				}
				if (sourceFileInput.artifactKey) {
					namedArtifactPaths[sourceFileInput.artifactKey] = safePath;
				}
			}

			const filePath = queuedFilePaths[0];
			if (!filePath) {
				return yield* badRequest("Import source requires at least one upload token");
			}

			const run = yield* create({ userId: user.id, source: body.source, inputSummary });
			const sandboxExecutionId = `${run.id}-import`;
			const pin = yield* workflowPinning
				.preRegister({
					executingUserId: user.id,
					scriptId: workflowScriptId,
					executionId: sandboxExecutionId,
					pluginSlug: registered.pluginSlug,
				})
				.pipe(Effect.either);
			if (Either.isLeft(pin)) {
				yield* failRun(run.id, "Failed to pin import workflow");
				yield* cleanupFiles(claimedFilePaths);
				return yield* badRequest("Could not queue the import job; please try again");
			}

			const started = yield* engine
				.execute(ProcessImportRunWorkflow, {
					discard: true,
					executionId: run.id,
					payload: {
						filePath,
						runId: run.id,
						userId: user.id,
						source: body.source,
						pluginSlug: registered.pluginSlug,
						workflowScriptId,
						...(Object.keys(namedArtifactPaths).length > 0 ? { namedArtifactPaths } : {}),
						...(Object.keys(sourcePayload).length > 0 ? { sourcePayload } : {}),
					},
				})
				.pipe(Effect.either);
			if (Either.isLeft(started)) {
				if (pin.right.registrationStatus === "registered") {
					yield* workflowPinning.release(sandboxExecutionId);
				}
				yield* failRun(run.id, "Failed to enqueue import job");
				yield* cleanupFiles(claimedFilePaths);
				return yield* badRequest("Could not queue the import job; please try again");
			}

			return { id: run.id };
		});

		const startSourcePayloadImportRun = Effect.fn("ImportsService.startSourcePayloadImportRun")(
			function* (
				user: CurrentUserValue,
				body: CreateImportRunBody,
				inputSummary: Record<string, unknown>,
				registered: RegisteredImportSource,
				workflowScriptId: SandboxScriptId,
			) {
				const sourcePayload = buildImportSourcePayload(body, registered);
				const run = yield* create({ userId: user.id, source: body.source, inputSummary });
				const sandboxExecutionId = `${run.id}-import`;

				if (sourcePayload) {
					const stored = yield* storeImportSourcePayload({ runId: run.id, sourcePayload }).pipe(
						Effect.provideService(RedisService, redis),
						Effect.either,
					);
					if (Either.isLeft(stored)) {
						yield* failRun(run.id, "Failed to queue import credentials");
						return yield* badRequest("Could not queue the import job; please try again");
					}
				}

				const pin = yield* workflowPinning
					.preRegister({
						executingUserId: user.id,
						scriptId: workflowScriptId,
						executionId: sandboxExecutionId,
						pluginSlug: registered.pluginSlug,
					})
					.pipe(Effect.either);
				if (Either.isLeft(pin)) {
					if (sourcePayload) {
						yield* deleteImportSourcePayload(run.id).pipe(
							Effect.provideService(RedisService, redis),
						);
					}
					yield* failRun(run.id, "Failed to pin import workflow");
					return yield* badRequest("Could not queue the import job; please try again");
				}

				const started = yield* engine
					.execute(ProcessImportRunWorkflow, {
						discard: true,
						executionId: run.id,
						payload: {
							runId: run.id,
							userId: user.id,
							workflowScriptId,
							source: body.source,
							pluginSlug: registered.pluginSlug,
							...(sourcePayload ? { sourcePayloadKey: run.id } : {}),
						},
					})
					.pipe(Effect.either);
				if (Either.isLeft(started)) {
					if (pin.right.registrationStatus === "registered") {
						yield* workflowPinning.release(sandboxExecutionId);
					}
					if (sourcePayload) {
						yield* deleteImportSourcePayload(run.id).pipe(
							Effect.provideService(RedisService, redis),
						);
					}
					yield* failRun(run.id, "Failed to enqueue import job");
					return yield* badRequest("Could not queue the import job; please try again");
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
				return yield* badRequest("Import source is not available");
			}
			const registered = resolution.source;
			const workflowScript = yield* runWithDb(resolution.script);
			if (!workflowScript) {
				return yield* badRequest("Import source workflow is not available");
			}
			const startError = yield* registryImportSourceStartError(registered);
			if (startError) {
				return yield* badRequest(startError);
			}
			const inputError = registryImportSourceInputError(registered, body);
			if (inputError) {
				return yield* badRequest(inputError);
			}

			const inputSummary = buildImportInputSummary(body, registered);
			const sourceFileInputs = registryImportSourceFileInputs(registered, body);

			return sourceFileInputs.length > 0
				? yield* startFileImportRun(
						user,
						body,
						inputSummary,
						sourceFileInputs,
						registered,
						workflowScript.id,
					)
				: yield* startSourcePayloadImportRun(
						user,
						body,
						inputSummary,
						registered,
						workflowScript.id,
					);
		});

		const listImportRuns = (user: CurrentUserValue) =>
			runWithDb(repository.listRuns({ type: "manual", userId: user.id }));

		const requireImportRun = Effect.fn("ImportsService.requireImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
		) {
			const run = yield* runWithDb(repository.getRunById({ runId, userId: user.id }));
			if (!run) {
				return yield* notFound("Import run not found");
			}

			return run;
		});

		const getImportRun = Effect.fn("ImportsService.getImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
			query: { page: number; limit: number },
		) {
			const run = yield* requireImportRun(user, runId);
			const failures = yield* runWithDb(
				repository.listFailuresByRunId({ runId, page: query.page, limit: query.limit }),
			);
			return { ...run, failures: { ...failures, page: query.page, limit: query.limit } };
		});

		const removeImportRun = Effect.fn("ImportsService.removeImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
		) {
			const run = yield* requireImportRun(user, runId);
			if (!isTerminalStatus(run.status)) {
				return yield* badRequest("Can only delete completed or failed import runs");
			}
			yield* deleteRun({ runId, userId: user.id });
			return { id: runId };
		});

		const listRunsByIntegrationId = (input: { userId: UserId; integrationId: IntegrationId }) =>
			runWithDb(repository.listRuns({ ...input, type: "integration" }));

		const hasActiveRunForIntegration = (input: { integrationId: IntegrationId }) =>
			runWithDb(repository.hasActiveRunForIntegration(input));

		const createRunForIntegration = (input: {
			userId: UserId;
			source: ImportRunSource;
			integrationId: IntegrationId;
			inputSummary: Record<string, unknown>;
		}) => create(input);

		const failRunForIntegration = Effect.fn("ImportsService.failRunForIntegration")(function* (
			runId: ImportRunId,
			message: string,
		) {
			const failure: ImportRunFailureDetails = {
				message,
				itemIndex: 0,
				stage: "source_fetch",
			};
			yield* failureService.create({ ...failure, runId });
			const finishedAt = yield* DateTime.nowAsDate;
			yield* update({
				runId,
				finishedAt,
				errorSummary: message,
				progress: 100,
				status: "failed",
				totalItems: 1,
				failedItems: 1,
				processedItems: 1,
			});
		});

		return {
			create,
			update,
			delete: deleteRun,
			getImportRun,
			listImportRuns,
			startImportRun,
			removeImportRun,
			failRunForIntegration,
			listRunsByIntegrationId,
			createRunForIntegration,
			hasActiveRunForIntegration,
		};
	}),
}) {}
