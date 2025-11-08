import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth";
import { BadRequest, NotFound, RateLimited, Unauthorized } from "#lib/errors";

import {
	CreateImportRunBody,
	DetailedImportRun,
	GetImportRunParams,
	ListedImportRun,
} from "./schemas";

const runIdParam = HttpApiSchema.param("runId", Schema.String);

export const ImportsGroup = HttpApiGroup.make("imports")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("createRun", "/imports/runs")
			.setPayload(CreateImportRunBody)
			.addSuccess(Schema.Struct({ id: Schema.String }), { status: 201 })
			.addError(BadRequest, { status: 400 }),
	)
	.add(HttpApiEndpoint.get("listRuns", "/imports/runs").addSuccess(Schema.Array(ListedImportRun)))
	.add(
		HttpApiEndpoint.get("getRun")`/imports/runs/${runIdParam}`
			.setUrlParams(GetImportRunParams)
			.addSuccess(DetailedImportRun)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("deleteRun")`/imports/runs/${runIdParam}`
			.addSuccess(Schema.Struct({ id: Schema.String }))
			.addError(NotFound, { status: 404 })
			.addError(BadRequest, { status: 400 }),
	);
