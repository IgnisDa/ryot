import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AdminMiddleware, AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { PluginIdentityReference } from "../plugins/references";
import { RyotQLDocument, RyotQLResponse } from "./language";

const RyotQLBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("invalid-query") }),
	Schema.Struct({
		reference: PluginIdentityReference,
		code: Schema.Literal("unresolved-query-owner"),
		issue: Schema.Literals([
			"missing",
			"unavailable",
			"wrong-scope",
			"self-unbound",
			"unauthorized",
		]),
	}),
	Schema.Struct({ code: Schema.Literal("invalid-cursor") }),
	Schema.Struct({ limitMs: Schema.Finite, code: Schema.Literal("query-timeout") }),
	Schema.Struct({ limitBytes: Schema.Finite, code: Schema.Literal("result-too-large") }),
]);

export class RyotQLBadRequest extends Schema.TaggedError<
	RyotQLBadRequest,
	{ readonly brand: unique symbol }
>()("RyotQLBadRequest", { reason: RyotQLBadRequestReason }) {}

export class RyotQLInternalError extends Schema.TaggedError<
	RyotQLInternalError,
	{ readonly brand: unique symbol }
>()("RyotQLInternalError", {
	reason: Schema.Struct({ code: Schema.Literal("execution-failed") }),
}) {}

const execution = {
	payload: RyotQLDocument,
	success: RyotQLResponse,
	error: [
		RyotQLBadRequest.pipe(HttpApiSchema.status(400)),
		RyotQLInternalError.pipe(HttpApiSchema.status(500)),
	],
};

export const RyotQLGroup = HttpApiGroup.make("ryotql")
	.annotate(OpenApi.Description, "Execute focused relational reads against application data.")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("execute", "/ryotql/execute", execution).annotate(
			OpenApi.Description,
			"Execute a RyotQL document and return its named results.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"executePlugin",
			"/ryotql/plugin/execute",
			execution,
		).annotate(
			OpenApi.Description,
			"Execute a RyotQL document on behalf of a client plugin, limited to plugin-readable tables and fields.",
		),
	)
	.middleware(AuthMiddleware);

export const AdminRyotQLGroup = HttpApiGroup.make("adminRyotql")
	.annotate(OpenApi.Description, "Execute administrative relational reads across all users.")
	.add(
		HttpApiEndpoint.post("execute", "/instance-admin/ryotql/execute", execution)
			.middleware(AdminMiddleware)
			.annotate(
				OpenApi.Description,
				"Execute a RyotQL document with administrative visibility and return its named results.",
			),
	);
