import { DateTime, Effect } from "effect";

import { DbRunner } from "~/lib/db";

import type { ImportRunJobData } from "../jobs";
import { ImportsRepository } from "../repository";
import { failImportRun, sanitizeErrorMessage } from "./failures";
import {
	cleanupImportFile,
	getTemporaryDirectory,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./files";
import { getImportSourceProcessor } from "./processor-registry";
import { getKnownImportExtensions } from "./source-definitions";
import { deleteImportSourcePayload, loadImportSourcePayload } from "./source-payload-store";

const resolveImportJobFilePath = (input: { runId: string; filePath: string | undefined }) =>
	Effect.gen(function* () {
		if (!input.filePath) {
			yield* failImportRun(input.runId, "Import job is missing file path");
			return null;
		}

		const tempDir = getTemporaryDirectory();
		const safePathResult = resolveSafeImportFilePath(input.filePath, tempDir);
		if ("error" in safePathResult) {
			yield* failImportRun(input.runId, "Import job has an invalid file path");
			return null;
		}

		const extResult = validateFileExtension(safePathResult.path, getKnownImportExtensions());
		if ("error" in extResult) {
			yield* cleanupImportFile(safePathResult.path);
			yield* failImportRun(input.runId, "Import job has an invalid file extension");
			return null;
		}

		return safePathResult.path;
	});

export const processImportJob = (payload: ImportRunJobData) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;

		const run = yield* runWithDb(
			repository.getRunById({ runId: payload.runId, userId: payload.userId }),
		);
		if (!run) {
			return;
		}

		const startedAt = yield* DateTime.nowAsDate;
		yield* runWithDb(repository.updateRun({ runId: payload.runId, status: "running", startedAt }));

		const sourceProcessor = getImportSourceProcessor(run.source);
		if (!sourceProcessor) {
			yield* failImportRun(payload.runId, `Unsupported import source: ${run.source}`);
			return;
		}

		const sourcePayload = payload.sourcePayloadKey
			? ((yield* loadImportSourcePayload(payload.sourcePayloadKey)) ?? undefined)
			: payload.sourcePayload;

		const failOnError = (error: unknown) =>
			failImportRun(
				payload.runId,
				sanitizeErrorMessage(error, "Import job failed unexpectedly"),
			).pipe(Effect.ignore);

		if (sourceProcessor.inputKind === "source_payload") {
			yield* sourceProcessor
				.process({ sourcePayload, runId: payload.runId, userId: payload.userId })
				.pipe(
					Effect.catchAll(failOnError),
					Effect.ensuring(
						payload.sourcePayloadKey
							? deleteImportSourcePayload(payload.sourcePayloadKey)
							: Effect.void,
					),
				);
			return;
		}

		const safePath = yield* resolveImportJobFilePath({
			runId: payload.runId,
			filePath: payload.filePath,
		});
		if (safePath === null) {
			return;
		}

		yield* sourceProcessor
			.process({ sourcePayload, filePath: safePath, runId: payload.runId, userId: payload.userId })
			.pipe(Effect.catchAll(failOnError));
	});
