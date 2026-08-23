import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
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
		HttpApiEndpoint.post("search", "/provider-entities/search", {
			error: providerEntityErrors,
			payload: SearchProviderEntitiesBody,
			success: SearchProviderEntitiesResponse,
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Searches a configured entity provider."),
	)
	.add(
		HttpApiEndpoint.post("searchOptions", "/provider-entities/search-options", {
			error: providerEntityErrors,
			payload: SearchProviderOptionsBody,
			success: SearchProviderOptionsResponse,
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Resolves a configured provider's search options schema."),
	)
	.add(
		HttpApiEndpoint.post("import", "/provider-entities/imports", {
			payload: ImportEntityBody,
			success: Schema.Struct({ jobId: Schema.String }),
			error: [
				...providerEntityErrors,
				ProviderEntityImportBacklogFull.pipe(HttpApiSchema.status(429)),
			],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(
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
		HttpApiEndpoint.delete("cancelImport", "/provider-entities/imports/:jobId", {
			error: providerEntityErrors,
			params: { jobId: Schema.String },
			success: Schema.Struct({ jobId: Schema.String }),
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Cancel a queued or running entity import job."),
	)
	.middleware(AuthMiddleware);
