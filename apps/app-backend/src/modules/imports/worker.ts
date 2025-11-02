import { DurableQueue, Workflow } from "@effect/workflow";
import { Layer, Schema } from "effect";

import { dieOnDbError } from "~/lib/errors";

import { ImportRunJobData } from "./jobs";
import { processImportJob } from "./runtime/processor";

class ImportRunError extends Schema.TaggedError<ImportRunError>()("ImportRunError", {
	message: Schema.String,
}) {}

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

const ProcessImportRunWorkflowLive = ProcessImportRunWorkflow.toLayer((payload) =>
	DurableQueue.process(ImportRunQueue, payload),
);

export const ImportWorkflowDefinitionsLive = Layer.mergeAll(
	ProcessImportRunWorkflowLive,
	ImportRunQueueWorkerLive,
);
