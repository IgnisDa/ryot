import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy, LogRouteTemplate } from "../../http-annotations";
import {
	ClientAssetNotFound,
	ClientDocumentGrantNotFound,
	ClientPagePreparationError,
	CheckClientPageFreshnessBody,
	CheckClientPageFreshnessResponse,
	PrepareClientPageBody,
	PreparedClientPage,
} from "./schemas";

export const ClientDocumentsGroup = HttpApiGroup.make("clientDocuments")
	.annotate(OpenApi.Description, "Serves capability-bound client composition documents")
	.add(
		HttpApiEndpoint.get("document", "/client-pages/documents/:token", {
			params: { token: Schema.String },
			error: [ClientDocumentGrantNotFound.pipe(HttpApiSchema.status(404))],
		})
			.annotate(LogRouteTemplate, true)
			.annotate(
				OpenApi.Description,
				"Generates no-store composition HTML with artifact access URLs for a document grant",
			),
	);

export const ClientAssetsGroup = HttpApiGroup.make("clientAssets")
	.annotate(OpenApi.Description, "Serves immutable public or capability-protected client artifacts")
	.add(
		HttpApiEndpoint.get("file", "/client-assets/:artifactHash/:accessKey/*", {
			error: [ClientAssetNotFound.pipe(HttpApiSchema.status(404))],
			params: { "*": Schema.String, accessKey: Schema.String, artifactHash: Schema.String },
		})
			.annotate(LogRouteTemplate, true)
			.annotate(
				OpenApi.Description,
				"Serves one immutable file by artifact hash and public or capability access key",
			),
	);

export const ClientPagesGroup = HttpApiGroup.make("clientPages")
	.annotate(OpenApi.Description, "Prepares client pages")
	.add(
		HttpApiEndpoint.post("prepare", "/client-pages/prepare", {
			success: PreparedClientPage,
			payload: PrepareClientPageBody,
			error: [ClientPagePreparationError.pipe(HttpApiSchema.status(404))],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(
				OpenApi.Description,
				"Resolves a client page, looks up its composition, and issues a document grant",
			),
	)
	.add(
		HttpApiEndpoint.post("checkFreshness", "/client-pages/freshness", {
			payload: CheckClientPageFreshnessBody,
			success: CheckClientPageFreshnessResponse,
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(
				OpenApi.Description,
				"Checks whether a prepared page still matches current catalog state",
			),
	)
	.middleware(AuthMiddleware);
