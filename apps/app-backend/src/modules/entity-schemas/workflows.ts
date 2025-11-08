import { DurableQueue } from "@effect/workflow";
import { Layer } from "effect";

import { DefaultSavedViewQueue } from "./durable-queues";
import { CreateDefaultSavedViewWorkflow } from "./workflow-definitions";

const CreateDefaultSavedViewWorkflowLive = CreateDefaultSavedViewWorkflow.toLayer((payload) =>
	DurableQueue.process(DefaultSavedViewQueue, payload),
);

export const EntitySchemaWorkflowDefinitionsLive = Layer.mergeAll(
	CreateDefaultSavedViewWorkflowLive,
);
