import { Workflow } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import { Schema } from "effect";

import { CreateDefaultSavedViewPayload } from "./durable-queues";

export const CreateDefaultSavedViewWorkflow = Workflow.make({
	error: DbError,
	success: Schema.Void,
	name: "CreateDefaultSavedViewWorkflow",
	payload: CreateDefaultSavedViewPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
