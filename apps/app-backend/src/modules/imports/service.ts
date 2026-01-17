import { FileSystem } from "@effect/platform";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type { CreateImportRunBody } from "@ryot/contract/modules/imports/schemas";
import type { ImportRunSource, ImportRunStatus } from "@ryot/contract/modules/imports/types";
import type { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { DateTime, Effect, Either } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";
import { UploadsService } from "#modules/uploads/service";

import { ImportRunFailuresService, type ImportRunFailureDetails } from "./failure-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { ImportsRepository } from "./repository";
import {
	cleanupImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./runtime/import-files";
import { makeImporterConfig } from "./runtime/importer-config";
import {
	buildInputSummary,
	buildSourcePayload,
	getImportSourceFileInputs,
	getImportSourceStartError,
} from "./runtime/source-definitions";
import {
	registryImportSourceFileInputs,
	registryImportSourceStartError,
	type ImportSourceFileInput,
} from "./runtime/source-metadata";
import {
	deleteImportSourcePayload,
	storeImportSourcePayload,
} from "./runtime/source-payload-store";

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
		) {
			const tempDir = config.tmpDir;
			const queuedFilePaths: string[] = [];
			const claimedFilePaths: string[] = [];

			const sourcePayload = buildSourcePayload(body) ?? {};

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
			}

			const filePath = queuedFilePaths[0];
			if (!filePath) {
				return yield* badRequest("Import source requires at least one upload token");
			}

			const run = yield* create({ userId: user.id, source: body.source, inputSummary });

			const started = yield* engine
				.execute(ProcessImportRunWorkflow, {
					discard: true,
					executionId: run.id,
					payload: {
						filePath,
						runId: run.id,
						userId: user.id,
						source: body.source,
						...(Object.keys(sourcePayload).length > 0 ? { sourcePayload } : {}),
					},
				})
				.pipe(Effect.either);
			if (Either.isLeft(started)) {
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
			) {
				const sourcePayload = buildSourcePayload(body);
				const run = yield* create({ userId: user.id, source: body.source, inputSummary });

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

				const started = yield* engine
					.execute(ProcessImportRunWorkflow, {
						discard: true,
						executionId: run.id,
						payload: {
							runId: run.id,
							userId: user.id,
							source: body.source,
							...(sourcePayload ? { sourcePayloadKey: run.id } : {}),
						},
					})
					.pipe(Effect.either);
				if (Either.isLeft(started)) {
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
			const registered = importSources.find(body.source);
			// Transitional: sources no plugin manifest declares still read their allowed extensions,
			// upload-token body fields, and required app config from the hardcoded
			// `runtime/source-definitions.ts` table. Tasks 09 and 10 move all nineteen sources onto the
			// registry and delete both that table and these fallback arms.
			const startError = registered
				? registryImportSourceStartError(registered, config)
				: getImportSourceStartError(body.source, makeImporterConfig(config));
			if (startError) {
				return yield* badRequest(startError);
			}

			const inputSummary = buildInputSummary(body);
			const sourceFileInputs = registered
				? registryImportSourceFileInputs(registered, body)
				: getImportSourceFileInputs(body);

			return sourceFileInputs.length > 0
				? yield* startFileImportRun(user, body, inputSummary, sourceFileInputs)
				: yield* startSourcePayloadImportRun(user, body, inputSummary);
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
