import { Schema } from "effect";

import { EntityId, RelationshipId, RelationshipSchemaSlug } from "../../schema/brands";

const RelationshipBadRequestReason = Schema.Union([
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
		relationshipSchemaSlug: RelationshipSchemaSlug,
		code: Schema.Literal("relationship-schema-not-found"),
	}),
]);

export class RelationshipBadRequest extends Schema.TaggedError<RelationshipBadRequest>()(
	"RelationshipBadRequest",
	{ reason: RelationshipBadRequestReason },
) {}

export class RelationshipNotFound extends Schema.TaggedError<RelationshipNotFound>()(
	"RelationshipNotFound",
	{ reason: RelationshipNotFoundReason },
) {}

export const RelationshipScope = Schema.Struct({
	id: RelationshipId,
	createdAt: Schema.String,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	properties: Schema.Unknown,
	wasInserted: Schema.Boolean,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

export type RelationshipScope = typeof RelationshipScope.Type;

export const CreateRelationshipBody = Schema.Struct({
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	properties: Schema.optional(Schema.Unknown),
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

export type CreateRelationshipBody = typeof CreateRelationshipBody.Type;
