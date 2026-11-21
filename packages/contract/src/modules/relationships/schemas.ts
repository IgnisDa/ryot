import { Message } from "@ryot-app/i18n/message";
import { Schema } from "effect";

import {
	AutomationRunId,
	EntityId,
	PluginId,
	RelationshipId,
	RelationshipKey,
	RelationshipSchemaSlug,
} from "../../schema/brands";
import { DefinitionOwner, RelationshipSchemaReference } from "../plugins/references";

const RelationshipBadRequestReason = Schema.Union([
	Schema.Struct({
		actual: DefinitionOwner,
		expected: DefinitionOwner,
		code: Schema.Literal("owner-mismatch"),
	}),
	Schema.Struct({ code: Schema.Literal("asset-forbidden") }),
	Schema.Struct({ code: Schema.Literal("invalid-relationship-key") }),
	Schema.Struct({ code: Schema.Literal("global-scope-forbidden") }),
	Schema.Struct({ sourceEntityId: EntityId, code: Schema.Literal("source-not-owned") }),
	Schema.Struct({ code: Schema.Literal("kernel-owned-schema") }),
	Schema.Struct({ message: Message, code: Schema.Literal("policy-rejected") }),
	Schema.Struct({ runId: AutomationRunId, code: Schema.Literal("policy-execution-failed") }),
	Schema.Struct({
		code: Schema.Literals([
			"automation-limit-reached",
			"concurrent-relationship-change",
			"invalid-policy-transform",
			"lifecycle-command-conflict",
		]),
	}),
	Schema.Struct({ code: Schema.Literal("reconciliation-selector-mismatch") }),
	Schema.Struct({ code: Schema.Literal("duplicate-reconciliation-relationship") }),
	Schema.Struct({
		code: Schema.Literal("invalid-properties"),
		paths: Schema.Array(Schema.Array(Schema.String)),
	}),
	Schema.Struct({
		actual: Schema.String,
		expected: Schema.String,
		code: Schema.Literals(["source-schema-mismatch", "target-schema-mismatch"]),
	}),
]);

const RelationshipNotFoundReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("relationship-not-found") }),
	Schema.Struct({
		code: Schema.Literal("entity-not-found"),
		entityIds: Schema.NonEmptyArray(EntityId),
	}),
	Schema.Struct({
		schema: RelationshipSchemaReference,
		code: Schema.Literal("relationship-schema-not-found"),
	}),
]);

export class RelationshipNotFound extends Schema.TaggedError<
	RelationshipNotFound,
	{ readonly brand: unique symbol }
>()("RelationshipNotFound", { reason: RelationshipNotFoundReason }) {}

export class RelationshipBadRequest extends Schema.TaggedError<
	RelationshipBadRequest,
	{ readonly brand: unique symbol }
>()("RelationshipBadRequest", { reason: RelationshipBadRequestReason }) {}

export const RelationshipScope = Schema.Struct({
	id: RelationshipId,
	createdAt: Schema.String,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	properties: Schema.Unknown,
	wasInserted: Schema.Boolean,
	key: Schema.optionalKey(RelationshipKey),
	relationshipSchemaSlug: RelationshipSchemaSlug,
	relationshipSchemaPluginId: Schema.NullOr(PluginId),
});

export type RelationshipScope = typeof RelationshipScope.Type;

export const RelationshipMutationResult = Schema.Struct({
	relationship: Schema.NullOr(RelationshipScope),
});
export type RelationshipMutationResult = typeof RelationshipMutationResult.Type;

export const CreateRelationshipBody = Schema.Struct({
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	key: Schema.optionalKey(RelationshipKey),
	properties: Schema.optional(Schema.Unknown),
	relationshipSchema: RelationshipSchemaReference,
});

export type CreateRelationshipBody = typeof CreateRelationshipBody.Type;
