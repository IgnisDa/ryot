import { Schema } from "@ryot/sandbox-sdk/effect";

import { jsonValueSchema } from "./wire";

export * from "@ryot/ryotql";
export { buildEntityReadDocument, buildEventReadDocument } from "@ryot/ryotql-recipes/sandbox";

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });

export const ryotqlBooleanFieldValueSchema = strictStruct({
	value: Schema.Boolean,
	kind: Schema.Literal("boolean"),
});
export const ryotqlDateFieldValueSchema = strictStruct({
	value: Schema.String,
	kind: Schema.Literal("date"),
});
export const ryotqlJsonFieldValueSchema = strictStruct({
	value: jsonValueSchema,
	kind: Schema.Literal("json"),
});
export const ryotqlNullFieldValueSchema = strictStruct({
	value: Schema.Null,
	kind: Schema.Literal("null"),
});
export const ryotqlNumberFieldValueSchema = strictStruct({
	value: Schema.Number,
	kind: Schema.Literal("number"),
});
export const ryotqlTextFieldValueSchema = strictStruct({
	value: Schema.String,
	kind: Schema.Literal("text"),
});

export const ryotqlFieldValueSchema = Schema.Union([
	ryotqlNullFieldValueSchema,
	ryotqlTextFieldValueSchema,
	ryotqlDateFieldValueSchema,
	ryotqlJsonFieldValueSchema,
	ryotqlNumberFieldValueSchema,
	ryotqlBooleanFieldValueSchema,
]);

export const ryotqlIncludeResultSchema = <A, I>(item: Schema.Codec<A, I>) =>
	strictStruct({
		items: Schema.Array(item),
		pageInfo: strictStruct({ limit: Schema.Int, hasMore: Schema.Boolean }),
	});

export const ryotqlRowsResultSchema = <A, I>(item: Schema.Codec<A, I>) =>
	strictStruct({
		items: Schema.Array(item),
		type: Schema.Literal("rows"),
		pageInfo: strictStruct({
			page: Schema.Int,
			limit: Schema.Int,
			total: Schema.Int,
			hasMore: Schema.Boolean,
		}),
	});

const ryotqlRowSchema: Schema.Codec<Readonly<Record<string, unknown>>, unknown> = Schema.suspend(
	() =>
		Schema.Record(
			Schema.String,
			Schema.Union([ryotqlFieldValueSchema, ryotqlIncludeResultSchema(ryotqlRowSchema)]),
		),
);

const ryotqlEnvelopeSchema = strictStruct({
	data: Schema.Record(Schema.String, Schema.Unknown),
});

const decodeRyotqlEnvelope = Schema.decodeUnknownSync(ryotqlEnvelopeSchema);

export const decodeRyotqlQuery = <A, I>(
	response: unknown,
	queryName: string,
	resultSchema: Schema.Codec<A, I>,
) => {
	const result = decodeRyotqlEnvelope(response).data[queryName];
	if (result === undefined) {
		throw new Error(`RyotQL response is missing named query '${queryName}'`);
	}
	return Schema.decodeUnknownSync(resultSchema)(result);
};

export const ryotqlRows = (response: unknown, queryName: string) =>
	decodeRyotqlQuery(response, queryName, ryotqlRowsResultSchema(ryotqlRowSchema));
