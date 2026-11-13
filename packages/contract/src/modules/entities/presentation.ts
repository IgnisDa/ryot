import { Schema } from "effect";

import { JsonValue } from "../../schema/json";
import { TimeZone } from "../../schema/time-zone";

export const ENTITY_PRESENTATION_FIELD = "__entityPresentation";
export const EntityPresentationContext = Schema.Struct({
	now: Schema.Finite,
	timeZone: TimeZone,
	settings: Schema.NullOr(Schema.Record(Schema.String, JsonValue)),
});
export const EntityPresentationPayload = Schema.Struct({
	pluginId: Schema.String,
	schemaSlug: Schema.String,
	context: EntityPresentationContext,
	scope: Schema.Literals(["entity", "owner"]),
	data: Schema.Record(Schema.String, JsonValue),
});
export type EntityPresentationPayload = typeof EntityPresentationPayload.Type;
