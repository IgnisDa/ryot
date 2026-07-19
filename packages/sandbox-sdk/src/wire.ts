import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import { Schema } from "@ryot/sandbox-sdk/effect";

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });

export const jsonValueSchema: Schema.Codec<JsonValue, JsonValue> = Schema.suspend(() =>
	Schema.Union([
		Schema.Null,
		Schema.String,
		Schema.Finite,
		Schema.Boolean,
		Schema.Array(jsonValueSchema),
		Schema.Record(Schema.String, jsonValueSchema),
	]),
).pipe(Schema.annotate({ identifier: "JsonValue" }));

export const sandboxHostErrorSchema = strictStruct({
	message: Schema.String,
	data: Schema.optional(jsonValueSchema),
});
export type SandboxHostError = Schema.Schema.Type<typeof sandboxHostErrorSchema>;

const hostFailureSchema = strictStruct({
	error: Schema.String,
	success: Schema.Literal(false),
	data: Schema.optional(jsonValueSchema),
});
export type SandboxHostFailure = Schema.Schema.Type<typeof hostFailureSchema>;

export const hostFailure = (error: string, data?: JsonValue) => ({
	error,
	success: false as const,
	...(data === undefined ? {} : { data }),
});

export const hostSuccess = <Data>(data: Data) => ({ data, success: true as const });

export const hostResultSchema = <Data extends Schema.Constraint>(data: Data) =>
	Schema.Union([hostFailureSchema, strictStruct({ data, success: Schema.Literal(true) })]);
