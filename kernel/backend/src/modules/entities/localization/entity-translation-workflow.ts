import { SandboxRunError } from "@ryot-app/contract/errors";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { EntityId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Schema } from "effect";
import { Workflow } from "effect/workflow";

import type { DurableSchema } from "#boot/workflow-engine";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";

export const TranslateEntityWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	lane: ExecutionLane,
	language: Schema.String,
	externalId: Schema.String,
	executionId: Schema.String,
	providerId: SandboxProviderId,
	contentGeneration: Schema.Int,
	command: DomainLifecycleCommand,
	entitySchemaSlug: Schema.String,
	principal: ScriptExecutionPrincipal,
	accountGeneration: AccountGeneration,
	entityScopeUserId: Schema.NullOr(UserId),
	entitySchemaPluginId: Schema.NullOr(Schema.String),
});

export type TranslateEntityWorkflowPayload = typeof TranslateEntityWorkflowPayload.Type;

export const TranslationExecution = Schema.Struct({
	name: Schema.String,
	contentGeneration: Schema.Int,
	principal: ScriptExecutionPrincipal,
	entityScopeUserId: Schema.NullOr(UserId),
	properties: Schema.Record(Schema.String, JsonValue),
});
export type TranslationExecution = typeof TranslationExecution.Type;

export const translateEntityExecutionId = (
	input: Pick<
		TranslateEntityWorkflowPayload,
		"entityId" | "contentGeneration" | "userId" | "accountGeneration" | "language"
	>,
) =>
	`translate-${sha256Hex(
		stableStringify([
			input.entityId,
			input.contentGeneration,
			input.userId,
			input.accountGeneration.token,
			input.language,
		]),
	)}`;

export const TranslateEntityAttemptWorkflowPayload = Schema.Struct({
	...TranslateEntityWorkflowPayload.fields,
	requestId: Schema.String,
	execution: TranslationExecution,
});
export type TranslateEntityAttemptWorkflowPayload =
	typeof TranslateEntityAttemptWorkflowPayload.Type;

export const TranslateEntityWorkflow = Workflow.make("TranslateEntityWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: SandboxRunError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: TranslateEntityWorkflowPayload satisfies DurableSchema,
});

export const TranslateEntityAttemptWorkflow = Workflow.make("TranslateEntityAttemptWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: SandboxRunError satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: TranslateEntityAttemptWorkflowPayload satisfies DurableSchema,
});
