import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { RyotQLDocument, RyotQLResponse } from "./language";

export const RyotQLGroup = HttpApiGroup.make("ryotql")
	.annotate(OpenApi.Description, "Execute focused relational reads against application data.")
	.add(
		HttpApiEndpoint.post("execute", "/ryotql/execute", {
			payload: RyotQLDocument,
			success: RyotQLResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Execute a RyotQL document and return its named results."),
	)
	.middleware(AuthMiddleware);
