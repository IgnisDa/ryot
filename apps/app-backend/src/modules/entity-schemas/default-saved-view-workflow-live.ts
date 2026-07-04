import { DurableQueue } from "@effect/workflow";
import { Effect, Layer } from "effect";

import { CreateDefaultSavedViewWorkflow } from "./default-saved-view-workflow";
import { DefaultSavedViewQueue } from "./durable-queues";

const CreateDefaultSavedViewWorkflowLive = CreateDefaultSavedViewWorkflow.toLayer(
	(payload, executionId) =>
		DurableQueue.process(DefaultSavedViewQueue, payload).pipe(
			Effect.annotateLogs({ executionId, workflow: "CreateDefaultSavedViewWorkflow" }),
		),
);

export const EntitySchemaWorkflowDefinitionsLive = Layer.mergeAll(
	CreateDefaultSavedViewWorkflowLive,
);
