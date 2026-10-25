import { Schema } from "effect";

import { EntityId, EventId, EventSchemaSlug } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { IsoUtcString, strictStruct } from "../../schema/utils";

export const EVENT_STREAM_BATCH_LIMITS = { streams: 100, updates: 1000, checkpointBytes: 16_384 };

export const EventStreamWorkRequest = strictStruct({
	entityId: EntityId,
	eventSchemaSlug: EventSchemaSlug,
});

export const EventStreamProcessorReference = strictStruct({
	scriptSlug: Schema.NonEmptyString,
	referenceKind: Schema.Literal("script"),
});

export const EventStreamBatchInput = strictStruct({
	eventSchemaSlug: EventSchemaSlug,
	streams: Schema.Array(
		strictStruct({
			entityId: EntityId,
			checkpoint: JsonValue,
			dirtyFrom: Schema.NullOr(IsoUtcString),
		}),
	).check(Schema.isMaxLength(EVENT_STREAM_BATCH_LIMITS.streams)),
});

export const EventStreamUpdate = strictStruct({
	eventId: EventId,
	properties: Schema.Record(Schema.String, JsonValue),
});

export const EventStreamBatchOutput = strictStruct({
	streams: Schema.Array(
		strictStruct({
			entityId: EntityId,
			done: Schema.Boolean,
			checkpoint: JsonValue,
			updates: Schema.Array(EventStreamUpdate),
		}),
	).check(Schema.isMaxLength(EVENT_STREAM_BATCH_LIMITS.streams)),
});
