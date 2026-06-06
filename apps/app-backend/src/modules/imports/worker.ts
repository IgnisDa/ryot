import { FileSystem } from "@effect/platform";
import { DurableQueue, Workflow } from "@effect/workflow";
import { Cause, Effect, Schema } from "effect";

import { SandboxRunError, unknownToMessage } from "~/lib/errors";
import { decodeEntityResolveResult } from "~/modules/entities/population";
import { runEntityImportWorkflow } from "~/modules/entities/workflows";
import { SandboxExecutionQueue } from "~/modules/sandbox/durable-queues";

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
import { failImportRun } from "./runtime/failures";
import { getTemporaryDirectory, resolveSafeImportFilePath } from "./runtime/files";
import { deleteImportSourcePayload } from "./runtime/source-payload-store";
import { adaptHevyCsv } from "./sources/hevy/adapter";
import { adaptStrongAppCsv } from "./sources/strong-app/adapter";
import { ImportRunError, runOneTimeMediaImportWorkflow } from "./workflows";
import { runOneTimeNonMediaImportWorkflow } from "./workflows-non-media";
import { WorkoutImportItemSchema } from "./workout/domain";
import { loadWorkoutAdapterResult, prepareWorkoutWrites } from "./workout/workflow";

const toSandboxError = (cause: unknown) =>
	cause instanceof SandboxRunError
		? cause
		: new SandboxRunError({ message: unknownToMessage(cause) });

const processSandboxEntityDetails = (
	payload: { userId: string; scriptId: string; externalId: string },
	executionId: string,
) =>
	DurableQueue.process(SandboxExecutionQueue, {
		driverName: "details",
		userId: payload.userId,
		scriptId: payload.scriptId,
		context: { externalId: payload.externalId },
		executionId: `${executionId}-sandbox-details`,
	}).pipe(Effect.mapError(toSandboxError));

const resolveSandboxEntityExternalId = (input: {
	value: string;
	userId: string;
	scriptId: string;
	executionId: string;
	identifierType: string;
}) =>
	DurableQueue.process(SandboxExecutionQueue, {
		userId: input.userId,
		driverName: "resolve",
		scriptId: input.scriptId,
		executionId: input.executionId,
		context: { value: input.value, identifierType: input.identifierType },
	}).pipe(
		Effect.mapError(toSandboxError),
		Effect.flatMap((result) =>
			result.error
				? Effect.fail(new SandboxRunError({ message: result.error }))
				: decodeEntityResolveResult(result.value).pipe(
						Effect.mapError(
							() =>
								new SandboxRunError({
									message: "Entity resolve script returned an unexpected shape",
								}),
						),
					),
		),
	);

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
				Effect.gen(function* () {
					if (!path.trim()) {
						return;
					}

					const safePathResult = resolveSafeImportFilePath(path, tempDir);
					if (!("error" in safePathResult)) {
						yield* fs.remove(safePathResult.path, { recursive: true });
						return;
					}

					return yield* new ImportRunError({ message: "Import cleanup path is invalid" });
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
			loadAdapterResult: loadOneTimeMediaImportAdapterResult,
			resolveExternalId: resolveSandboxEntityExternalId,
			importEntity: (input) =>
				runEntityImportWorkflow(
					{
						userId: input.userId,
						scriptId: input.scriptId,
						externalId: input.externalId,
						executionId: input.executionId,
						entitySchemaId: input.entitySchemaId,
					},
					input.executionId,
					(entityPayload, childExecutionId) =>
						processSandboxEntityDetails(entityPayload, childExecutionId),
					{
						skipLibraryMembership: true,
						activityPrefix: input.activityPrefix,
					},
				).pipe(
					Effect.map((entity) => ({ id: entity.id })),
					Effect.catchAllCause((cause) =>
						Effect.fail(
							new SandboxRunError({
								message: unknownToMessage(Cause.squash(cause)),
							}),
						),
					),
				),
		});
	}),
);

export const ImportWorkflowDefinitionsLive = ProcessImportRunWorkflowLive;
