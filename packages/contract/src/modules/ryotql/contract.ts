import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
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

export const RyotQLGroup = HttpApiGroup.make("ryotql")
	.annotate(OpenApi.Description, "Execute focused relational reads against application data.")
	.add(
		HttpApiEndpoint.post("execute", "/ryotql/execute", {
			payload: RyotQLDocument,
			success: RyotQLResponse,
			error: [
				RyotQLBadRequest.pipe(HttpApiSchema.status(400)),
				RyotQLInternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Execute a RyotQL document and return its named results."),
	)
	.middleware(AuthMiddleware);
