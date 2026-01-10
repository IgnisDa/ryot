import { Schema } from "@ryot/sandbox-sdk/effect";

const strictStruct = <Fields extends Record<string, Schema.Struct.Field>>(fields: Fields) =>
	Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "error" as const } });

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export const jsonValueSchema: Schema.Schema<JsonValue, JsonValue> = Schema.suspend(() =>
	Schema.Union(
		Schema.Null,
		Schema.String,
		Schema.Boolean,
		Schema.Number,
		Schema.Array(jsonValueSchema),
		Schema.Record({ key: Schema.String, value: jsonValueSchema }),
	),
);
export const sandboxHostErrorSchema = strictStruct({ message: Schema.String });
export type SandboxHostError = Schema.Schema.Type<typeof sandboxHostErrorSchema>;

export const hostFailureSchema = strictStruct({
	error: Schema.String,
	success: Schema.Literal(false),
});
export const hostResultSchema = <Data extends Schema.Schema.AnyNoContext>(data: Data) =>
	Schema.Union(hostFailureSchema, strictStruct({ data, success: Schema.Literal(true) }));
export type HostFailure = Schema.Schema.Type<typeof hostFailureSchema>;
export type HostResult<Data> = HostFailure | { readonly data: Data; readonly success: true };
