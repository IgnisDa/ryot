import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { QueryDocument, QueryResponse } from "./language";

export const QueryEngineGroup = HttpApiGroup.make("queryEngine")
	.annotate(OpenApi.Description, "Execute structured queries against application data.")
	.add(
		HttpApiEndpoint.post("execute", "/query-engine/execute", {
			payload: QueryDocument,
			success: QueryResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Execute a query document and return its results."),
	)
	.middleware(AuthMiddleware);
