import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import {
	ImportEntityBody,
	ImportEntityRunResult,
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "./schemas";

export const ProviderEntitiesGroup = HttpApiGroup.make("providerEntities")
	.annotate(OpenApi.Description, "Searches and imports provider entities.")
	.add(
		HttpApiEndpoint.post("search", "/provider-entities/search", {
			payload: SearchProviderEntitiesBody,
			success: SearchProviderEntitiesResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Searches configured entity providers for a saved view."),
	)
	.add(
		HttpApiEndpoint.post("import", "/provider-entities/imports", {
			payload: ImportEntityBody,
			success: Schema.Struct({ jobId: Schema.String }),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Start an entity import job."),
	)
	.add(
		HttpApiEndpoint.get("getImportResult", "/provider-entities/imports/:jobId", {
			params: { jobId: Schema.String },
			success: ImportEntityRunResult,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Retrieve the result of an entity import job."),
	)
	.middleware(AuthMiddleware);
