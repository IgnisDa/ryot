import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { ImportEntityBody, ImportEntityRunResult } from "./schemas";

export const EntityImportGroup = HttpApiGroup.make("entityImport")
	.annotate(OpenApi.Description, "Import entities.")
	.add(
		HttpApiEndpoint.post("import", "/entity-import", {
			payload: ImportEntityBody,
			success: Schema.Struct({ jobId: Schema.String }),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Start an entity import job."),
	)
	.add(
		HttpApiEndpoint.get("getImportResult", "/entity-import/:jobId", {
			params: { jobId: Schema.String },
			success: ImportEntityRunResult,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Retrieve the result of an entity import job."),
	)
	.middleware(AuthMiddleware);
