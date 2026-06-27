import { Workflow } from "@effect/workflow";
import { SandboxRunError } from "@ryot/contract/errors";
import { EntityId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const TranslateEntityWorkflowPayload = Schema.Struct({
	entityId: EntityId,
	language: Schema.String,
	externalId: Schema.String,
	scriptId: SandboxScriptId,
	properties: Schema.Unknown,
	executionId: Schema.String,
	entitySchemaSlug: Schema.String,
});

export type TranslateEntityWorkflowPayload = typeof TranslateEntityWorkflowPayload.Type;

export const translateEntityExecutionId = (input: { entityId: EntityId; language: string }) =>
	`translate-${input.entityId}-${input.language}`;

export const TranslateEntityWorkflow = Workflow.make({
	success: Schema.Void,
	error: SandboxRunError,
	name: "TranslateEntityWorkflow",
	payload: TranslateEntityWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
