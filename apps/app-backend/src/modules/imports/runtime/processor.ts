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

const resolveImportJobFilePath = (input: { runId: string; filePath: string }) =>
	Effect.gen(function* () {
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

		const safePath = yield* resolveImportJobFilePath({
			runId: payload.runId,
			filePath: payload.filePath,
		});
		if (safePath === null) {
			return;
		}

		yield* sourceProcessor
			.process({ filePath: safePath, runId: payload.runId, userId: payload.userId })
			.pipe(
				Effect.catchAll((error) =>
					failImportRun(
						payload.runId,
						sanitizeErrorMessage(error, "Import job failed unexpectedly"),
					).pipe(Effect.ignore),
				),
			);
	});
