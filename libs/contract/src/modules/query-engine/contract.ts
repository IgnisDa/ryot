import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { QueryDocument, QueryResponse } from "./language";

export const QueryEngineGroup = HttpApiGroup.make("queryEngine")
	.annotate(OpenApi.Description, "Execute structured queries against application data.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("execute", "/query-engine/execute")
			.annotate(OpenApi.Description, "Execute a query document and return its results.")
			.setPayload(QueryDocument)
			.addSuccess(QueryResponse)
			.addError(NotFound, { status: 404 }),
	);
