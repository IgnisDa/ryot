import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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

export const ProviderEntitiesGroup = HttpApiGroup.make("providerEntities")
	.annotate(OpenApi.Description, "Searches and imports provider entities.")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("search", "/provider-entities/search", {
			error: providerEntityErrors,
			payload: SearchProviderEntitiesBody,
			success: SearchProviderEntitiesResponse,
		}).annotate(OpenApi.Description, "Searches a configured entity provider."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"searchOptions",
			"/provider-entities/search-options",
			{
				error: providerEntityErrors,
				payload: SearchProviderOptionsBody,
				success: SearchProviderOptionsResponse,
			},
		).annotate(OpenApi.Description, "Resolves a configured provider's search options schema."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("import", "/provider-entities/imports", {
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
		HttpApiEndpoint.get("getImportResult", "/provider-entities/imports/:jobId", {
			error: providerEntityErrors,
			success: ImportEntityRunResult,
			params: { jobId: Schema.String },
		}).annotate(OpenApi.Description, "Retrieve the result of an entity import job."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("allowed")(
			"cancelImport",
			"/provider-entities/imports/:jobId",
			{
				error: providerEntityErrors,
				params: { jobId: Schema.String },
				success: Schema.Struct({ jobId: Schema.String }),
			},
		).annotate(OpenApi.Description, "Cancel a queued or running entity import job."),
	)
	.middleware(AuthMiddleware);
