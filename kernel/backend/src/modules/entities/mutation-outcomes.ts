import { AutomationEntitySnapshot } from "@ryot-app/contract/modules/automations/lifecycle";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

export const EntityReferenceSnapshot = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaSlug: Schema.String,
});

export type EntityReferenceSnapshot = typeof EntityReferenceSnapshot.Type;

export const EntityMutationOutcome = Schema.Union([
	Schema.Struct({
		before: Schema.Null,
		after: AutomationEntitySnapshot,
		operation: Schema.Literal("create"),
	}),
	Schema.Struct({
		after: AutomationEntitySnapshot,
		before: AutomationEntitySnapshot,
		operation: Schema.Literal("update"),
	}),
	Schema.Struct({
		after: AutomationEntitySnapshot,
		before: AutomationEntitySnapshot,
		operation: Schema.Literal("noop"),
	}),
]);

export type EntityMutationOutcome = typeof EntityMutationOutcome.Type;

export const EntitySaveResult = Schema.Struct({
	entity: ListedEntity,
	wasInserted: Schema.Boolean,
	outcome: EntityMutationOutcome,
});
export type EntitySaveResult = typeof EntitySaveResult.Type;
