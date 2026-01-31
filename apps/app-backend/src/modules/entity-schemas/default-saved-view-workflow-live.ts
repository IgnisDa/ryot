import { DurableQueue } from "@effect/workflow";
import { Effect, Layer } from "effect";

import { CreateDefaultSavedViewWorkflow } from "./default-saved-view-workflow";
import { type CreateDefaultSavedViewPayload, DefaultSavedViewQueue } from "./durable-queues";

const runCreateDefaultSavedViewWorkflow = Effect.fn("CreateDefaultSavedViewWorkflow")(
	function* (payload: CreateDefaultSavedViewPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId });
		yield* DurableQueue.process(DefaultSavedViewQueue, payload);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "CreateDefaultSavedViewWorkflow" }),
);

const CreateDefaultSavedViewWorkflowLive = CreateDefaultSavedViewWorkflow.toLayer(
	runCreateDefaultSavedViewWorkflow,
);

export const EntitySchemaWorkflowDefinitionsLive = Layer.mergeAll(
	CreateDefaultSavedViewWorkflowLive,
);
