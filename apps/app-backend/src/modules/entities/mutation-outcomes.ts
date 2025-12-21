import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { EntityId, EntitySchemaId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const EntityReferenceSnapshot = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaSlug: Schema.String,
});

export type EntityReferenceSnapshot = typeof EntityReferenceSnapshot.Type;

export const EntityMutationSnapshot = Schema.Struct({
	...EntityReferenceSnapshot.fields,
	properties: Schema.Unknown,
	entitySchemaId: EntitySchemaId,
});

export type EntityMutationSnapshot = typeof EntityMutationSnapshot.Type;

export const EntityMutationOutcome = Schema.Union(
	Schema.Struct({
		before: Schema.Null,
		after: EntityMutationSnapshot,
		operation: Schema.Literal("create"),
	}),
	Schema.Struct({
		after: EntityMutationSnapshot,
		before: EntityMutationSnapshot,
		operation: Schema.Literal("update"),
	}),
	Schema.Struct({
		after: EntityMutationSnapshot,
		before: EntityMutationSnapshot,
		operation: Schema.Literal("noop"),
	}),
);

export type EntityMutationOutcome = typeof EntityMutationOutcome.Type;

export const ProviderEntitySaveResult = Schema.Struct({
	entity: ListedEntity,
	outcome: EntityMutationOutcome,
});

export type ProviderEntitySaveResult = typeof ProviderEntitySaveResult.Type;
