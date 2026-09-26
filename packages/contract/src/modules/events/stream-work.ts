import { Schema } from "effect";

import { EntityId, EventSchemaSlug } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { IsoUtcString, strictStruct } from "../../schema/utils";
import { UpdateEventItem } from "./schemas";

export const EventStreamWorkRequest = strictStruct({
	entityId: EntityId,
	eventSchemaSlug: EventSchemaSlug,
	outputProperties: Schema.Array(Schema.NonEmptyString).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(20),
		Schema.makeFilter(
			(keys) => new Set(keys).size === keys.length || "Expected unique output properties",
		),
	),
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
	updates: Schema.Array(UpdateEventItem).check(Schema.isMaxLength(100)),
});
