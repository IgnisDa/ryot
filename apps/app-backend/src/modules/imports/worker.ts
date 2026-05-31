import { FileSystem } from "@effect/platform";
import { Workflow } from "@effect/workflow";
import { Effect, Schema } from "effect";

import { unknownToMessage } from "~/lib/errors";

import { ImportRunJobData } from "./jobs";
import {
	OpenScaleImportItemSchema,
	loadOpenScaleAdapterResult,
	prepareOpenScaleWrites,
} from "./measurement/workflow";
import {
	isOneTimeMediaImportSource,
	loadOneTimeMediaImportAdapterResult,
} from "./media/source-loaders";
import {
	importMediaEntityViaWorkflow,
	resolveSandboxEntityExternalId,
} from "./media/workflow-operations";
import { failImportRun } from "./runtime/failures";
import { getTemporaryDirectory, resolveSafeImportFilePath } from "./runtime/files";
import { deleteImportSourcePayload } from "./runtime/source-payload-store";
import { adaptHevyCsv } from "./sources/hevy/adapter";
import { adaptStrongAppCsv } from "./sources/strong-app/adapter";
import { ImportRunError, runOneTimeMediaImportWorkflow } from "./workflows";
import { runOneTimeNonMediaImportWorkflow } from "./workflows-non-media";
import { WorkoutImportItemSchema } from "./workout/domain";
import { loadWorkoutAdapterResult, prepareWorkoutWrites } from "./workout/workflow";

const cleanupImportArtifacts = (input: {
	sourcePayloadKey?: string;
	cleanupPaths: ReadonlyArray<string>;
}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const tempDir = getTemporaryDirectory();

		if (input.sourcePayloadKey) {
			yield* deleteImportSourcePayload(input.sourcePayloadKey);
		}

		yield* Effect.forEach(
			new Set(input.cleanupPaths),
			(path) =>
				!path.trim()
					? Effect.void
					: Effect.gen(function* () {
							const safePathResult = resolveSafeImportFilePath(path, tempDir);
							if ("error" in safePathResult) {
								return yield* new ImportRunError({ message: "Import cleanup path is invalid" });
							}

							return yield* fs.remove(safePathResult.path, { recursive: true });
						}),
			{ discard: true },
		);
	});

const runNonMediaImport = (payload: ImportRunJobData) => {
	if (payload.source === "open_scale") {
		return runOneTimeNonMediaImportWorkflow(payload, {
			cleanupArtifacts: cleanupImportArtifacts,
			itemSchema: OpenScaleImportItemSchema,
			prepareWrites: prepareOpenScaleWrites,
			loadAdapterResult: loadOpenScaleAdapterResult,
		});
	}
	if (payload.source === "hevy") {
		return runOneTimeNonMediaImportWorkflow(payload, {
			cleanupArtifacts: cleanupImportArtifacts,
			itemSchema: WorkoutImportItemSchema,
			prepareWrites: prepareWorkoutWrites,
			loadAdapterResult: loadWorkoutAdapterResult({ sourceName: "Hevy", adapt: adaptHevyCsv }),
		});
	}
	if (payload.source === "strong_app") {
		return runOneTimeNonMediaImportWorkflow(payload, {
			cleanupArtifacts: cleanupImportArtifacts,
			itemSchema: WorkoutImportItemSchema,
			prepareWrites: prepareWorkoutWrites,
			loadAdapterResult: loadWorkoutAdapterResult({
				adapt: adaptStrongAppCsv,
				sourceName: "StrongApp",
			}),
		});
	}
	return failImportRun(payload.runId, `Unsupported import source: ${payload.source}`).pipe(
		Effect.mapError((error) => new ImportRunError({ message: unknownToMessage(error) })),
	);
};

export const ProcessImportRunWorkflow = Workflow.make({
	success: Schema.Void,
	error: ImportRunError,
	payload: ImportRunJobData,
	name: "ProcessImportRunWorkflow",
	idempotencyKey: ({ runId }) => runId,
});

const ProcessImportRunWorkflowLive = ProcessImportRunWorkflow.toLayer((payload, executionId) =>
	Effect.gen(function* () {
		if (!isOneTimeMediaImportSource(payload.source)) {
			yield* runNonMediaImport(payload);
			return;
		}

		yield* runOneTimeMediaImportWorkflow(payload, executionId, {
			cleanupArtifacts: cleanupImportArtifacts,
			importEntity: importMediaEntityViaWorkflow,
			resolveExternalId: resolveSandboxEntityExternalId,
			loadAdapterResult: loadOneTimeMediaImportAdapterResult,
		});
	}),
);

export const ImportWorkflowDefinitionsLive = ProcessImportRunWorkflowLive;
