import {
	JsonValue as jsonValueSchema,
	type JsonPrimitive,
	type JsonValue,
} from "@ryot-app/contract/schema/json";
import { Schema } from "@ryot-app/sandbox-sdk/effect";

export { jsonValueSchema };
export type { JsonPrimitive, JsonValue };

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });

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
