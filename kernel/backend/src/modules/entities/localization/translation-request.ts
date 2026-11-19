import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { EntityId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Duration, Schema } from "effect";

import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { makeJobKind } from "#platform/jobs/queue";

export const TranslationRequestPayload = Schema.Struct({
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
	entityScopeUserId: Schema.NullOr(UserId),
	entitySchemaPluginId: Schema.NullOr(Schema.String),
});

export type TranslationRequestPayload = typeof TranslationRequestPayload.Type;

export const TranslationExecution = Schema.Struct({
	name: Schema.String,
	contentGeneration: Schema.Int,
	principal: ScriptExecutionPrincipal,
	entityScopeUserId: Schema.NullOr(UserId),
	properties: Schema.Record(Schema.String, JsonValue),
});
export type TranslationExecution = typeof TranslationExecution.Type;

export const translateEntityExecutionId = (
	input: Pick<TranslationRequestPayload, "userId" | "entityId" | "language" | "contentGeneration">,
) =>
	`translate-${sha256Hex(
		stableStringify([input.entityId, input.contentGeneration, input.userId, input.language]),
	)}`;

export const explicitTranslationExecutionId = (entityId: EntityId, language: string, key: string) =>
	`translate-${sha256Hex(stableStringify(["refresh", entityId, language, key]))}`;

export const EntityTranslationJob = makeJobKind("entity-translation", {
	maxAttempts: 3,
	concurrency: 8,
	backoff: Duration.seconds(5),
	payload: Schema.Struct({ requestId: Schema.String }),
});
