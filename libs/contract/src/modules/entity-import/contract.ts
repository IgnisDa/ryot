import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { ImportEntityBody, ImportEntityRunResult } from "./schemas";

const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const EntityImportGroup = HttpApiGroup.make("entityImport")
	.annotate(OpenApi.Description, "Import entities.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("import", "/entity-import")
			.annotate(OpenApi.Description, "Start an entity import job.")
			.setPayload(ImportEntityBody)
			.addSuccess(Schema.Struct({ jobId: Schema.String }))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("getImportResult")`/entity-import/${jobIdParam}`
			.annotate(OpenApi.Description, "Retrieve the result of an entity import job.")
			.addSuccess(ImportEntityRunResult)
			.addError(NotFound, { status: 404 }),
	);
