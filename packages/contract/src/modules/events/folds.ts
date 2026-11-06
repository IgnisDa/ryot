import { Schema } from "effect";

import { EntityId, EventId, RelationshipId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { EventMutationChange } from "./mutations";

export const FOLD_LIMITS = { changes: 500, valueBytes: 262_144, requestEntities: 100 };

export const FoldInput = strictStruct({ value: JsonValue, subjectEntityId: EntityId });

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
