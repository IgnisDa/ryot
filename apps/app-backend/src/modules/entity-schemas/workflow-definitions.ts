import { Workflow } from "@effect/workflow";
import { Schema } from "effect";

import { DbError } from "#lib/errors";

import { CreateDefaultSavedViewPayload } from "./durable-queues";

export const CreateDefaultSavedViewWorkflow = Workflow.make({
	error: DbError,
	success: Schema.Void,
	name: "CreateDefaultSavedViewWorkflow",
	payload: CreateDefaultSavedViewPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
