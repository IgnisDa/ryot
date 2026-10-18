import { Schema } from "effect";

import { EntityId, EventId, EventSchemaSlug } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { IsoUtcString, strictStruct } from "../../schema/utils";

export const EventStreamWorkRequest = strictStruct({
	entityId: EntityId,
	eventSchemaSlug: EventSchemaSlug,
});

export const EventStreamProcessorReference = strictStruct({
	scriptSlug: Schema.NonEmptyString,
	referenceKind: Schema.Literal("script"),
});

export const EventStreamStepInput = strictStruct({
	entityId: EntityId,
	checkpoint: JsonValue,
	eventSchemaSlug: EventSchemaSlug,
	dirtyFrom: Schema.NullOr(IsoUtcString),
});

export const EventStreamStepOutput = strictStruct({
	done: Schema.Boolean,
	checkpoint: JsonValue,
	updates: Schema.Array(
		strictStruct({ eventId: EventId, properties: Schema.Record(Schema.String, JsonValue) }),
	).check(Schema.isMaxLength(100)),
});
