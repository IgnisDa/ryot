import { Schema, SchemaGetter } from "effect";

import {
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
} from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { AutomationWarning } from "../automations/lifecycle";
import { DefinitionOwner, EntitySchemaReference } from "../plugins/references";

const EntityBadRequestReason = Schema.Union([
	Schema.Struct({
		actual: DefinitionOwner,
		expected: DefinitionOwner,
		code: Schema.Literal("owner-mismatch"),
	}),
	Schema.Struct({ code: Schema.Literal("asset-forbidden") }),
	Schema.Struct({ code: Schema.Literal("global-scope-forbidden") }),
	Schema.Struct({ code: Schema.Literal("provider-scope-mismatch") }),
	Schema.Struct({ code: Schema.Literal("kernel-owned-schema") }),
	Schema.Struct({ code: Schema.Literal("provider-owned") }),
	Schema.Struct({ code: Schema.Literal("duplicate-collection-name") }),
	Schema.Struct({ property: Schema.String, code: Schema.Literal("immutable-property") }),
	Schema.Struct({
		message: Schema.String,
		code: Schema.Literals([
			"automation-limit",
			"policy-rejected",
			"invalid-policy-transform",
			"mutation-conflict",
			"enclosing-transaction",
		]),
	}),
	Schema.Struct({ runId: AutomationRunId, code: Schema.Literal("policy-execution-failed") }),
	Schema.Struct({ field: Schema.Literal("name"), code: Schema.Literal("name-required") }),
	Schema.Struct({
		code: Schema.Literal("incomplete-provenance"),
		fields: Schema.Tuple([Schema.Literal("externalId"), Schema.Literal("providerId")]),
	}),
	Schema.Struct({
		code: Schema.Literal("invalid-properties"),
		paths: Schema.Array(Schema.Array(Schema.String)),
	}),
	Schema.Struct({
		field: Schema.Literal("maximumTotal"),
		code: Schema.Literal("invalid-maximum-total"),
	}),
]);

const EntityNotFoundReason = Schema.Union([
	Schema.Struct({ entityId: EntityId, code: Schema.Literal("entity-not-found") }),
	Schema.Struct({ schema: EntitySchemaReference, code: Schema.Literal("entity-schema-not-found") }),
]);

export class EntityBadRequest extends Schema.TaggedError<
	EntityBadRequest,
	{ readonly brand: unique symbol }
>()("EntityBadRequest", { reason: EntityBadRequestReason }) {}

export class EntityNotFound extends Schema.TaggedError<
	EntityNotFound,
	{ readonly brand: unique symbol }
>()("EntityNotFound", { reason: EntityNotFoundReason }) {}

export class EntityStale extends Schema.TaggedError<
	EntityStale,
	{ readonly brand: unique symbol }
>()("EntityStale", {
	reason: strictStruct({ entityId: EntityId, code: Schema.Literal("entity-stale") }),
}) {}

export class EntityEnrichmentRefused extends Schema.TaggedError<
	EntityEnrichmentRefused,
	{ readonly brand: unique symbol }
>()("EntityEnrichmentRefused", {
	reason: strictStruct({
		code: Schema.Literals([
			"not-provider-backed",
			"plugin-mismatch",
			"provider-unavailable",
			"request-mismatch",
			"backlog-full",
		]),
	}),
}) {}

export const RequestEntityEnrichmentBody = strictStruct({
	pluginId: PluginId,
	action: Schema.Literals(["refresh", "retry"]),
	operation: Schema.Literals(["population", "translation"]),
	idempotencyKey: Schema.String.pipe(
		Schema.check(Schema.isMinLength(1)),
		Schema.check(Schema.isMaxLength(128)),
	),
});

export const RequestEntityEnrichmentResult = Schema.Struct({
	enrichmentRequestId: Schema.NullOr(Schema.String),
});

export type RequestEntityEnrichmentResult = typeof RequestEntityEnrichmentResult.Type;

export const ListedEntity = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: Schema.Unknown,
	entitySchemaSlug: EntitySchemaSlug,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(Schema.String),
	providerId: Schema.NullOr(SandboxProviderId),
	entitySchemaPluginId: Schema.NullOr(PluginId),
});

export type ListedEntity = typeof ListedEntity.Type;

export const EntityMutationResult = Schema.Struct({
	entity: ListedEntity,
	warnings: Schema.Array(AutomationWarning),
});
export type EntityMutationResult = typeof EntityMutationResult.Type;

export const EnrichmentState = Schema.Struct({
	availability: Schema.Literals(["missing", "partial", "complete", "none"]),
	state: Schema.Literals([
		"idle",
		"queued",
		"running",
		"retrying",
		"succeeded",
		"failed",
		"cancelled",
	]),
});

export type EnrichmentState = typeof EnrichmentState.Type;

export const EntitySyncState = Schema.Struct({
	populationStatus: EnrichmentState,
	translationStatus: EnrichmentState,
});

export type EntitySyncState = typeof EntitySyncState.Type;

const OptionalExternalId = Schema.String.pipe(
	Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
		encode: SchemaGetter.transform((value) => value ?? ""),
		decode: SchemaGetter.transform((value) => {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : undefined;
		}),
	}),
);

const OptionalSandboxProviderId = Schema.String.pipe(
	Schema.decodeTo(Schema.UndefinedOr(SandboxProviderId), {
		encode: SchemaGetter.transform((value) => value ?? ""),
		decode: SchemaGetter.transform((value) => {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : undefined;
		}),
	}),
);

export const CreateEntityBody = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	entitySchema: EntitySchemaReference,
	externalId: Schema.optional(OptionalExternalId),
	providerId: Schema.optional(OptionalSandboxProviderId),
});

export type CreateEntityBody = typeof CreateEntityBody.Type;
