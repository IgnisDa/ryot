import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";

import { AuthMiddleware } from "#lib/auth-middleware";
import { BadRequest, NotFound, Unauthorized } from "#lib/errors";

import { QueryDocumentV2, QueryResponseV2 } from "./language";

export const QueryEngineV2Group = HttpApiGroup.make("queryEngineV2")
	.addError(Unauthorized, { status: 401 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("execute", "/query-engine-v2/execute")
			.setPayload(QueryDocumentV2)
			.addSuccess(QueryResponseV2)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	);
