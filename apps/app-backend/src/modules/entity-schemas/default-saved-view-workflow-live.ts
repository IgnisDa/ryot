import { DurableQueue } from "@effect/workflow";
import { Layer } from "effect";

import { CreateDefaultSavedViewWorkflow } from "./default-saved-view-workflow";
import { DefaultSavedViewQueue } from "./durable-queues";

const CreateDefaultSavedViewWorkflowLive = CreateDefaultSavedViewWorkflow.toLayer((payload) =>
	DurableQueue.process(DefaultSavedViewQueue, payload),
);

export const EntitySchemaWorkflowDefinitionsLive = Layer.mergeAll(
	CreateDefaultSavedViewWorkflowLive,
);
