import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AdminMiddleware, AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
import { RyotQLDocument, RyotQLResponse } from "./language";

const RyotQLBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("invalid-query") }),
	Schema.Struct({ code: Schema.Literal("invalid-cursor") }),
	Schema.Struct({ limitMs: Schema.Number, code: Schema.Literal("query-timeout") }),
]);

export class RyotQLBadRequest extends Schema.TaggedError<RyotQLBadRequest>()("RyotQLBadRequest", {
	reason: RyotQLBadRequestReason,
}) {}

export class RyotQLInternalError extends Schema.TaggedError<RyotQLInternalError>()(
	"RyotQLInternalError",
	{ reason: Schema.Struct({ code: Schema.Literal("execution-failed") }) },
) {}

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
		HttpApiEndpoint.post("execute", "/ryotql/execute", execution)
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Execute a RyotQL document and return its named results."),
	)
	.add(
		HttpApiEndpoint.post("executePlugin", "/ryotql/plugin/execute", execution)
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(
				OpenApi.Description,
				"Execute a RyotQL document on behalf of a client plugin, limited to plugin-readable tables and fields.",
			),
	)
	.middleware(AuthMiddleware);

export const AdminRyotQLGroup = HttpApiGroup.make("adminRyotql")
	.annotate(OpenApi.Description, "Execute administrative relational reads across all users.")
	.add(
		HttpApiEndpoint.post("execute", "/god-mode/ryotql/execute", execution)
			.middleware(AdminMiddleware)
			.annotate(
				OpenApi.Description,
				"Execute a RyotQL document with administrative visibility and return its named results.",
			),
	);
