import { SandboxRunError } from "@ryot/contract/errors";
import { EntityId, SandboxProviderId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

export const TranslateEntityWorkflowPayload = Schema.Struct({
	entityId: EntityId,
	language: Schema.String,
	externalId: Schema.String,
	properties: Schema.Unknown,
	executionId: Schema.String,
	providerId: SandboxProviderId,
	entitySchemaSlug: Schema.String,
});

export type TranslateEntityWorkflowPayload = typeof TranslateEntityWorkflowPayload.Type;

export const translateEntityExecutionId = (input: { entityId: EntityId; language: string }) =>
	`translate-${input.entityId}-${input.language}`;

export const TranslateEntityWorkflow = Workflow.make("TranslateEntityWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: SandboxRunError satisfies DurableSchema,
	payload: TranslateEntityWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
});
