import { FileSystem } from "@effect/platform";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DateTime, Effect, Either } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { AppConfig } from "#lib/config";
import { DbRunner } from "#lib/db";
import { badRequest, notFound } from "#lib/errors";
import { RedisService } from "#lib/redis";
import type { ImportRunId, IntegrationId, UserId } from "#lib/schema/brands";
import { UploadsService } from "#modules/uploads/service";

import { ImportsRepository } from "./repository";
import { failImportRunWithFailures } from "./runtime/failures";
import {
	cleanupImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./runtime/files";
import { makeImporterConfig } from "./runtime/importer-config";
import {
	buildInputSummary,
	buildSourcePayload,
	getImportSourceFileInputs,
	getImportSourceStartError,
} from "./runtime/source-definitions";
import {
	deleteImportSourcePayload,
	storeImportSourcePayload,
} from "./runtime/source-payload-store";
import type { CreateImportRunBody } from "./schemas";
import type { ImportRunSource, ImportRunStatus } from "./types";
import { ProcessImportRunWorkflow } from "./worker";

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

		const storeSourcePayload = (input: {
			runId: ImportRunId;
			sourcePayload: Record<string, unknown>;
		}) => storeImportSourcePayload(input).pipe(Effect.provideService(RedisService, redis));

		const deleteSourcePayload = (runId: ImportRunId) =>
			deleteImportSourcePayload(runId).pipe(Effect.provideService(RedisService, redis));

		const cleanupFiles = (paths: ReadonlyArray<string>) =>
			Effect.forEach(
				new Set(paths),
				(path) => cleanupImportFile(path).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
				{ discard: true },
			);

		const failRun = Effect.fn("ImportsService.failRun")(function* (
			runId: ImportRunId,
			errorSummary: string,
		) {
			const finishedAt = yield* DateTime.nowAsDate;
			yield* runWithDb(repository.updateRun({ runId, status: "failed", errorSummary, finishedAt }));
		});

		const startFileImportRun = Effect.fn("ImportsService.startFileImportRun")(function* (
			user: CurrentUserValue,
			body: CreateImportRunBody,
			inputSummary: Record<string, unknown>,
			sourceFileInputs: ReturnType<typeof getImportSourceFileInputs>,
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

			const run = yield* runWithDb(
				repository.createRun({ userId: user.id, source: body.source, inputSummary }),
			);

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
				const run = yield* runWithDb(
					repository.createRun({ userId: user.id, source: body.source, inputSummary }),
				);

				if (sourcePayload) {
					const stored = yield* storeSourcePayload({ runId: run.id, sourcePayload }).pipe(
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
						yield* deleteSourcePayload(run.id);
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
			const startError = getImportSourceStartError(body.source, makeImporterConfig(config));
			if (startError) {
				return yield* badRequest(startError);
			}

			const inputSummary = buildInputSummary(body);
			const sourceFileInputs = getImportSourceFileInputs(body);

			return sourceFileInputs.length > 0
				? yield* startFileImportRun(user, body, inputSummary, sourceFileInputs)
				: yield* startSourcePayloadImportRun(user, body, inputSummary);
		});

		const listImportRuns = (user: CurrentUserValue) =>
			runWithDb(repository.listRunsByUser({ userId: user.id }));

		const getImportRun = Effect.fn("ImportsService.getImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
			query: { page: number; limit: number },
		) {
			const run = yield* runWithDb(repository.getRunById({ runId, userId: user.id }));
			if (!run) {
				return yield* notFound("Import run not found");
			}
			const failures = yield* runWithDb(
				repository.listFailuresByRunId({ runId, page: query.page, limit: query.limit }),
			);
			return { ...run, failures: { ...failures, page: query.page, limit: query.limit } };
		});

		const removeImportRun = Effect.fn("ImportsService.removeImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
		) {
			const run = yield* runWithDb(repository.getRunById({ runId, userId: user.id }));
			if (!run) {
				return yield* notFound("Import run not found");
			}
			if (!isTerminalStatus(run.status)) {
				return yield* badRequest("Can only delete completed or failed import runs");
			}
			yield* runWithDb(repository.deleteRunById({ runId, userId: user.id }));
			return { id: runId };
		});

		const listRunsByIntegrationId = (input: { userId: UserId; integrationId: IntegrationId }) =>
			runWithDb(repository.listRunsByIntegrationId(input));

		const hasActiveRunForIntegration = (input: { integrationId: IntegrationId }) =>
			runWithDb(repository.hasActiveRunForIntegration(input));

		const createRunForIntegration = (input: {
			userId: UserId;
			source: ImportRunSource;
			integrationId: IntegrationId;
			inputSummary: Record<string, unknown>;
		}) =>
			runWithDb(
				repository.createRun({
					userId: input.userId,
					source: input.source,
					inputSummary: input.inputSummary,
					integrationId: input.integrationId,
				}),
			);

		const failRunForIntegration = Effect.fn("ImportsService.failRunForIntegration")(function* (
			runId: ImportRunId,
			message: string,
		) {
			yield* failImportRunWithFailures({
				runId,
				errorSummary: message,
				failures: [{ message, itemIndex: 0, stage: "source_fetch" }],
			});
		});

		return {
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
