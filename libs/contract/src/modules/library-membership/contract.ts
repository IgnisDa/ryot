import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { ImportEntityBody, ImportEntityRunResult } from "../entity-import/schemas";

const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const EntityImportGroup = HttpApiGroup.make("entityImport")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("import", "/library/import")
			.setPayload(ImportEntityBody)
			.addSuccess(Schema.Struct({ jobId: Schema.String }))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("getImportResult")`/library/import/${jobIdParam}`
			.addSuccess(ImportEntityRunResult)
			.addError(NotFound, { status: 404 }),
	);
