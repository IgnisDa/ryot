import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { ImportRunId } from "../../schema/brands";
import {
	CreateImportRunBody,
	DetailedImportRun,
	GetImportRunParams,
	ListedImportRun,
} from "./schemas";

const runIdParam = HttpApiSchema.param("runId", ImportRunId);

export const ImportsGroup = HttpApiGroup.make("imports")
	.annotate(OpenApi.Description, "Creates and manages data import runs")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("createRun", "/imports/runs")
			.setPayload(CreateImportRunBody)
			.addSuccess(Schema.Struct({ id: Schema.String }), { status: 201 })
			.annotate(OpenApi.Description, "Creates an import run"),
	)
	.add(
		HttpApiEndpoint.get("listRuns", "/imports/runs")
			.addSuccess(Schema.Array(ListedImportRun))
			.annotate(OpenApi.Description, "Lists import runs"),
	)
	.add(
		HttpApiEndpoint.get("getRun")`/imports/runs/${runIdParam}`
			.setUrlParams(GetImportRunParams)
			.addSuccess(DetailedImportRun)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Gets an import run by ID"),
	)
	.add(
		HttpApiEndpoint.del("deleteRun")`/imports/runs/${runIdParam}`
			.addSuccess(Schema.Struct({ id: Schema.String }))
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Deletes an import run by ID"),
	);
