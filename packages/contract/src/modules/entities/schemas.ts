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

export const TranslationStatus = Schema.Literals(["pending", "ready", "none"]);

export type TranslationStatus = typeof TranslationStatus.Type;

export const PopulationStatus = Schema.Literals(["pending", "ready", "none"]);

export type PopulationStatus = typeof PopulationStatus.Type;

export const EntitySyncState = Schema.Struct({
	populationStatus: PopulationStatus,
	translationStatus: TranslationStatus,
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
