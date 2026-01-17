import { RelationshipId, RelationshipSchemaSlug } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

import { EntityReferenceSnapshot } from "#modules/entities/mutation-outcomes";

export const RelationshipMutationSnapshot = Schema.Struct({
	id: RelationshipId,
	properties: Schema.Unknown,
	sourceEntity: EntityReferenceSnapshot,
	targetEntity: EntityReferenceSnapshot,
	relationshipSchemaSlug: RelationshipSchemaSlug,
});

export type RelationshipMutationSnapshot = typeof RelationshipMutationSnapshot.Type;

export const RelationshipMutationOutcome = Schema.Union(
	Schema.Struct({
		before: Schema.Null,
		after: RelationshipMutationSnapshot,
		operation: Schema.Literal("create"),
	}),
	Schema.Struct({
		after: RelationshipMutationSnapshot,
		operation: Schema.Literal("update"),
		before: RelationshipMutationSnapshot,
	}),
	Schema.Struct({
		after: Schema.Null,
		operation: Schema.Literal("delete"),
		before: RelationshipMutationSnapshot,
	}),
	Schema.Struct({
		operation: Schema.Literal("noop"),
		after: RelationshipMutationSnapshot,
		before: RelationshipMutationSnapshot,
	}),
);

export type RelationshipMutationOutcome = typeof RelationshipMutationOutcome.Type;

export const RelationshipMutationOutcomes = Schema.Array(RelationshipMutationOutcome);
