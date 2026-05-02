import { FileSystem } from "@effect/platform";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DateTime, Effect, Either } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { DbRunner } from "#lib/db";
import { type BadRequest, type DbError, type NotFound, badRequest, notFound } from "#lib/errors";
import { RedisService } from "#lib/redis";
import { UploadsService } from "#modules/uploads/service";

import { ImportsRepository } from "./repository";
import {
	cleanupImportFile,
	getTemporaryDirectory,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./runtime/files";
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
import type { CreateImportRunBody, DetailedImportRun, ListedImportRun } from "./schemas";
import type { ImportRunStatus } from "./types";
import { ProcessImportRunWorkflow } from "./worker";

const isTerminalStatus = (status: ImportRunStatus): boolean =>
	status === "completed" || status === "failed";

type ImportsServiceShape = {
	readonly startImportRun: (
		user: CurrentUserValue,
		body: CreateImportRunBody,
	) => Effect.Effect<{ id: string }, BadRequest | DbError>;
	readonly listImportRuns: (
		user: CurrentUserValue,
	) => Effect.Effect<readonly ListedImportRun[], DbError>;
	readonly getImportRun: (
		user: CurrentUserValue,
		runId: string,
		query: { page: number; limit: number },
	) => Effect.Effect<DetailedImportRun, NotFound | DbError>;
	readonly removeImportRun: (
		user: CurrentUserValue,
		runId: string,
	) => Effect.Effect<{ id: string }, BadRequest | NotFound | DbError>;
};

export class ImportsService extends Effect.Service<ImportsService>()("ImportsService", {
	effect: Effect.gen(function* () {
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const uploads = yield* UploadsService;
		const fs = yield* FileSystem.FileSystem;
		const repository = yield* ImportsRepository;

		const storeSourcePayload = (input: { runId: string; sourcePayload: Record<string, unknown> }) =>
			storeImportSourcePayload(input).pipe(Effect.provideService(RedisService, redis));

		const deleteSourcePayload = (runId: string) =>
			deleteImportSourcePayload(runId).pipe(Effect.provideService(RedisService, redis));

		const cleanupFiles = (paths: ReadonlyArray<string>) =>
			Effect.forEach(
				new Set(paths),
				(path) => cleanupImportFile(path).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
				{ discard: true },
			);

		const failRun = (runId: string, errorSummary: string) =>
			Effect.gen(function* () {
				const finishedAt = yield* DateTime.nowAsDate;
				yield* runWithDb(
					repository.updateRun({ runId, status: "failed", errorSummary, finishedAt }),
				);
			});

		const startFileImportRun = (
			user: CurrentUserValue,
			body: CreateImportRunBody,
			inputSummary: Record<string, unknown>,
			sourceFileInputs: ReturnType<typeof getImportSourceFileInputs>,
		) =>
			Effect.gen(function* () {
				const queuedFilePaths: string[] = [];
				const claimedFilePaths: string[] = [];

				const tempDir = getTemporaryDirectory();
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

					const safePathResult = resolveSafeImportFilePath(claim.right.resolvedPath, tempDir);
					if ("error" in safePathResult) {
						yield* cleanupFiles(claimedFilePaths);
						return yield* badRequest(safePathResult.error);
					}
					const safePath = safePathResult.path;
					claimedFilePaths[claimedFilePaths.length - 1] = safePath;

					const extResult = validateFileExtension(safePath, sourceFileInput.allowedExtensions);
					if ("error" in extResult) {
						yield* cleanupFiles(claimedFilePaths);
						return yield* badRequest(extResult.error);
					}

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

		const startSourcePayloadImportRun = (
			user: CurrentUserValue,
			body: CreateImportRunBody,
			inputSummary: Record<string, unknown>,
		) =>
			Effect.gen(function* () {
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
			});

		const startImportRun: ImportsServiceShape["startImportRun"] = (user, body) =>
			Effect.gen(function* () {
				const startError = getImportSourceStartError(body.source);
				if (startError) {
					return yield* badRequest(startError);
				}

				const inputSummary = buildInputSummary(body);
				const sourceFileInputs = getImportSourceFileInputs(body);

				return sourceFileInputs.length > 0
					? yield* startFileImportRun(user, body, inputSummary, sourceFileInputs)
					: yield* startSourcePayloadImportRun(user, body, inputSummary);
			});

		const listImportRuns: ImportsServiceShape["listImportRuns"] = (user) =>
			runWithDb(repository.listRunsByUser({ userId: user.id }));

		const getImportRun: ImportsServiceShape["getImportRun"] = (user, runId, query) =>
			Effect.gen(function* () {
				const run = yield* runWithDb(repository.getRunById({ runId, userId: user.id }));
				if (!run) {
					return yield* notFound("Import run not found");
				}
				const failures = yield* runWithDb(
					repository.listFailuresByRunId({ runId, page: query.page, limit: query.limit }),
				);
				return { ...run, failures: { ...failures, page: query.page, limit: query.limit } };
			});

		const removeImportRun: ImportsServiceShape["removeImportRun"] = (user, runId) =>
			Effect.gen(function* () {
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

		return {
			getImportRun,
			listImportRuns,
			startImportRun,
			removeImportRun,
		} satisfies ImportsServiceShape;
	}),
}) {}
