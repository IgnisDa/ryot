import { SandboxRunError } from "@ryot-app/contract/errors";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { EntityId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

import type { DurableSchema } from "#lib/infrastructure/workflow";
import { laneWorkflow } from "#lib/infrastructure/workflow-lane";

export const TranslateEntityWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	lane: ExecutionLane,
	language: Schema.String,
	externalId: Schema.String,
	properties: Schema.Unknown,
	executionId: Schema.String,
	providerId: SandboxProviderId,
	entitySchemaSlug: Schema.String,
	accountGeneration: AccountGeneration,
});

export type TranslateEntityWorkflowPayload = typeof TranslateEntityWorkflowPayload.Type;

export const translateEntityExecutionId = (input: { entityId: EntityId; language: string }) =>
	`translate-${input.entityId}-${input.language}`;

export const TranslateEntityWorkflow = laneWorkflow("TranslateEntityWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: SandboxRunError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: TranslateEntityWorkflowPayload satisfies DurableSchema,
});
