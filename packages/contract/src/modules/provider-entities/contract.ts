import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import {
	ImportEntityBody,
	ImportEntityRunResult,
	ProviderEntityBadRequest,
	ProviderEntityInternalError,
	ProviderEntityNotFound,
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
	SearchProviderOptionsBody,
	SearchProviderOptionsResponse,
} from "./schemas";

const providerEntityErrors = [
	ProviderEntityBadRequest.pipe(HttpApiSchema.status(400)),
	ProviderEntityNotFound.pipe(HttpApiSchema.status(404)),
	ProviderEntityInternalError.pipe(HttpApiSchema.status(500)),
] as const;

export const ProviderEntitiesGroup = HttpApiGroup.make("providerEntities")
	.annotate(OpenApi.Description, "Searches and imports provider entities.")
	.add(
		HttpApiEndpoint.post("search", "/provider-entities/search", {
			error: providerEntityErrors,
			payload: SearchProviderEntitiesBody,
			success: SearchProviderEntitiesResponse,
		}).annotate(OpenApi.Description, "Searches a configured entity provider."),
	)
	.add(
		HttpApiEndpoint.post("searchOptions", "/provider-entities/search-options", {
			error: providerEntityErrors,
			payload: SearchProviderOptionsBody,
			success: SearchProviderOptionsResponse,
		}).annotate(OpenApi.Description, "Resolves a configured provider's search options schema."),
	)
	.add(
		HttpApiEndpoint.post("import", "/provider-entities/imports", {
			payload: ImportEntityBody,
			error: providerEntityErrors,
			success: Schema.Struct({ jobId: Schema.String }),
		}).annotate(OpenApi.Description, "Start an entity import job."),
	)
	.add(
		HttpApiEndpoint.get("getImportResult", "/provider-entities/imports/:jobId", {
			error: providerEntityErrors,
			success: ImportEntityRunResult,
			params: { jobId: Schema.String },
		}).annotate(OpenApi.Description, "Retrieve the result of an entity import job."),
	)
	.middleware(AuthMiddleware);
