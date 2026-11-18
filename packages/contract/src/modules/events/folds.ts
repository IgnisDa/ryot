import { Schema } from "effect";

import { EntityId, EventId, RelationshipId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { EventMutationChange } from "./mutations";

export const FOLD_LIMITS = {
	changes: 500,
	valueBytes: 262_144,
	inputChanges: 500,
	requestEntities: 100,
};

/** The value of a subject that merged or restored into this one, with the IDs it holds and what they became. */
export const FoldAbsorbed = strictStruct({
	value: JsonValue,
	ids: Schema.Record(Schema.String, Schema.String),
});

/** An event as the fold sees it: `orderKey` and `orderCreatedAt` fall back to its ID and creation time. */
export const FoldEventImage = strictStruct({
	id: EventId,
	revision: Schema.Int,
	entityId: EntityId,
	orderKey: Schema.String,
	occurredAt: Schema.String,
	orderCreatedAt: Schema.String,
	eventSchemaSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	sessionEntityId: Schema.NullOr(EntityId),
	properties: Schema.Record(Schema.String, JsonValue),
});
export type FoldEventImage = typeof FoldEventImage.Type;

/** `before` is the event while it belonged to the subject and `after` is it now; null outside the subject. */
export const FoldEventChange = strictStruct({
	before: Schema.NullOr(FoldEventImage),
	after: Schema.NullOr(FoldEventImage),
});
export type FoldEventChange = typeof FoldEventChange.Type;

export const FoldInput = strictStruct({
	value: JsonValue,
	subjectEntityId: EntityId,
	absorbed: Schema.Array(FoldAbsorbed),
	changes: Schema.NullOr(Schema.Array(FoldEventChange)),
});

export const FoldOutput = strictStruct({
	value: JsonValue,
	changes: Schema.Array(EventMutationChange).check(Schema.isMaxLength(FOLD_LIMITS.changes)),
	events: Schema.Array(
		strictStruct({ eventId: EventId, properties: Schema.Record(Schema.String, JsonValue) }),
	),
	relationships: Schema.Array(
		strictStruct({
			relationshipId: RelationshipId,
			properties: Schema.Record(Schema.String, JsonValue),
		}),
	),
});

export const FoldRequest = strictStruct({
	entityIds: Schema.Array(EntityId).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(FOLD_LIMITS.requestEntities),
	),
});
