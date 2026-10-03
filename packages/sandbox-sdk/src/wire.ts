import {
	JsonValue as jsonValueSchema,
	type JsonPrimitive,
	type JsonValue,
} from "@ryot-app/contract/schema/json";
import { Schema } from "@ryot-app/sandbox-sdk/effect";

export { jsonValueSchema };
export type { JsonPrimitive, JsonValue };

export const strictStruct = <Fields extends Schema.Struct.Fields>(
	fields: Fields,
): Schema.Struct<Fields> => {
	const declared = new Set(Object.keys(fields));
	const struct = Schema.Struct(fields);
	const excessKey = Schema.String.check(
		Schema.makeFilter((key: string) => (declared.has(key) ? "declared property" : undefined)),
	);
	const strict = Schema.StructWithRest(struct, [
		Schema.Record(excessKey, Schema.Never.annotate({ identifier: "no excess property" })),
	]);
	return struct.rebuild(strict.ast);
};

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
