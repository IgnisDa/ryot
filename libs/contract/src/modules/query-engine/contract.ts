import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { QueryDocument, QueryResponse } from "./language";

export const QueryEngineGroup = HttpApiGroup.make("queryEngine")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("execute", "/query-engine/execute")
			.setPayload(QueryDocument)
			.addSuccess(QueryResponse)
			.addError(NotFound, { status: 404 }),
	);
