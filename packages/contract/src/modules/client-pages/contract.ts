import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { LogRouteTemplate } from "../../http-annotations";
import {
	ClientAssetNotFound,
	ClientCompositionDocument,
	ClientCompositionDocumentBody,
	ClientPageDocumentStale,
	ClientPagePreparationError,
	CheckClientPageFreshnessBody,
	CheckClientPageFreshnessResponse,
	PrepareClientPageBody,
	PreparedClientPage,
} from "./schemas";

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
		AuthenticatedMutationEndpoint.post("allowed")("prepare", "/client-pages/prepare", {
			success: PreparedClientPage,
			payload: PrepareClientPageBody,
			error: [ClientPagePreparationError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Resolves a client page and looks up its composition"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("checkFreshness", "/client-pages/freshness", {
			payload: CheckClientPageFreshnessBody,
			success: CheckClientPageFreshnessResponse,
		}).annotate(
			OpenApi.Description,
			"Checks whether a prepared page still matches current catalog state",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("document", "/client-pages/document", {
			success: ClientCompositionDocument,
			payload: ClientCompositionDocumentBody,
			error: [ClientPageDocumentStale.pipe(HttpApiSchema.status(409))],
		}).annotate(
			OpenApi.Description,
			"Generates the composition document for a prepared page that still matches current catalog state",
		),
	)
	.middleware(AuthMiddleware);
