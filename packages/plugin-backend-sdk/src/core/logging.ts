import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema, strictStruct } from "../wire";
import { nonEmptyString } from "./primitives";

export const logEntrySchema = strictStruct({
	message: nonEmptyString,
	level: Schema.Literals(["debug", "info", "warning", "error"]),
	attributes: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
});
export type LogEntry = Schema.Schema.Type<typeof logEntrySchema>;
export const logEntriesSchema = Schema.Array(logEntrySchema);
export const logArgsSchema = Schema.Tuple([logEntriesSchema]);
export const logResultSchema = hostResultSchema(Schema.Null);
export const spanEntrySchema = strictStruct({
	name: nonEmptyString,
	attributes: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)),
});
export type SpanEntry = Schema.Schema.Type<typeof spanEntrySchema>;
export const spanResultSchema = hostResultSchema(Schema.Null);
export const spanEntriesSchema = Schema.Array(spanEntrySchema);
export const spanArgsSchema = Schema.Tuple([spanEntriesSchema]);
