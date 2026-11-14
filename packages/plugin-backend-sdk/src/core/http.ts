import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { strictStruct } from "../wire";

export const httpCallOptionsSchema = strictStruct({
	body: Schema.optional(Schema.String),
	allowInsecureConnections: Schema.optional(Schema.Boolean),
	headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export const httpCallResponseSchema = strictStruct({
	body: Schema.String,
	headers: Schema.Record(Schema.String, Schema.String),
	status: Schema.Number.pipe(Schema.check(Schema.isInt())),
});
export const httpCallFailureDetailsSchema = Schema.Union([
	strictStruct({
		body: Schema.String,
		headers: Schema.Record(Schema.String, Schema.String),
		status: Schema.Number.pipe(Schema.check(Schema.isInt())),
	}),
	strictStruct({ code: Schema.Literals(["destination-denied", "external-uncertain"]) }),
]);
export const httpCallArgsSchema = Schema.Tuple([
	Schema.String,
	Schema.String,
	Schema.optionalKey(httpCallOptionsSchema),
]);
export const httpCallResultSchema = Schema.Union([
	strictStruct({
		error: Schema.String,
		success: Schema.Literal(false),
		data: Schema.optional(httpCallFailureDetailsSchema),
	}),
	strictStruct({ data: httpCallResponseSchema, success: Schema.Literal(true) }),
]);
