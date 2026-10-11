import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import {
	ImportEntityBody,
	ImportEntityRunResult,
	ProviderEntityBadRequest,
	ProviderEntityImportBacklogFull,
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

export const EntityProvidersGroup = HttpApiGroup.make("entityProviders")
	.annotate(OpenApi.Description, "Searches and imports provider entities.")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("search", "/entity-providers/search", {
			error: providerEntityErrors,
			payload: SearchProviderEntitiesBody,
			success: SearchProviderEntitiesResponse,
		}).annotate(OpenApi.Description, "Searches a configured entity provider."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"searchOptions",
			"/entity-providers/search-options",
			{
				error: providerEntityErrors,
				payload: SearchProviderOptionsBody,
				success: SearchProviderOptionsResponse,
			},
		).annotate(OpenApi.Description, "Resolves a configured provider's search options schema."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("import", "/entity-providers/imports", {
			payload: ImportEntityBody,
			success: Schema.Struct({ jobId: Schema.String }),
			error: [
				...providerEntityErrors,
				ProviderEntityImportBacklogFull.pipe(HttpApiSchema.status(429)),
			],
		}).annotate(
			OpenApi.Description,
			"Queue an entity import job. Repeating a queued or running import returns its job.",
		),
	)
	.add(
		HttpApiEndpoint.get("getImportResult", "/entity-providers/imports/:jobId", {
			error: providerEntityErrors,
			success: ImportEntityRunResult,
			params: { jobId: Schema.String },
		}).annotate(OpenApi.Description, "Retrieve the result of an entity import job."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("allowed")(
			"cancelImport",
			"/entity-providers/imports/:jobId",
			{
				error: providerEntityErrors,
				params: { jobId: Schema.String },
				success: Schema.Struct({ jobId: Schema.String }),
			},
		).annotate(OpenApi.Description, "Cancel a queued or running entity import job."),
	)
	.middleware(AuthMiddleware);
