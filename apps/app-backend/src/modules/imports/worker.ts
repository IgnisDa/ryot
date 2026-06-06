import { FileSystem } from "@effect/platform";
import { DurableQueue, Workflow } from "@effect/workflow";
import { Cause, Effect, Layer, Schema } from "effect";

import { SandboxRunError, dieOnDbError, unknownToMessage } from "~/lib/errors";
import { decodeEntityResolveResult } from "~/modules/entities/population";
import { runEntityImportWorkflow } from "~/modules/entities/workflows";
import { SandboxExecutionQueue } from "~/modules/sandbox/durable-queues";

import { ImportRunJobData } from "./jobs";
import {
	isOneTimeMediaImportSource,
	loadOneTimeMediaImportAdapterResult,
} from "./media/source-loaders";
import { getTemporaryDirectory, resolveSafeImportFilePath } from "./runtime/files";
import { processImportJob } from "./runtime/processor";
import { deleteImportSourcePayload } from "./runtime/source-payload-store";
import { ImportRunError, runOneTimeMediaImportWorkflow } from "./workflows";

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

export const ImportRunQueue = DurableQueue.make({
	success: Schema.Void,
	error: ImportRunError,
	payload: ImportRunJobData,
	name: "ImportRunProcessingQueue",
	idempotencyKey: ({ runId }) => runId,
});

export const ImportRunQueueWorkerLive = DurableQueue.worker(
	ImportRunQueue,
	(payload) => processImportJob(payload).pipe(dieOnDbError),
	{ concurrency: 1 },
);

export const ProcessImportRunWorkflow = Workflow.make({
	success: Schema.Void,
	error: ImportRunError,
	payload: ImportRunJobData,
	name: "ProcessImportRunWorkflow",
	idempotencyKey: ({ runId }) => runId,
});

const ProcessImportRunWorkflowLive = ProcessImportRunWorkflow.toLayer((payload, executionId) =>
	isOneTimeMediaImportSource(payload.source)
		? runOneTimeMediaImportWorkflow(payload, executionId, {
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
			})
		: DurableQueue.process(ImportRunQueue, payload),
);

export const ImportWorkflowDefinitionsLive = Layer.mergeAll(
	ProcessImportRunWorkflowLive,
	ImportRunQueueWorkerLive,
);
