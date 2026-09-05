import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy, LogRouteTemplate } from "../../http-annotations";
import {
	ClientPageArtifactGrantNotFound,
	ClientPagePreparationError,
	CheckClientPageFreshnessBody,
	CheckClientPageFreshnessResponse,
	PrepareClientPageBody,
	PreparedClientPage,
} from "./schemas";

export const ClientPageArtifactsGroup = HttpApiGroup.make("clientPageArtifacts")
	.annotate(OpenApi.Description, "Serves files from authenticated client page artifact grants")
	.add(
		HttpApiEndpoint.get("file", "/client-pages/artifacts/:token/*", {
			params: { "*": Schema.String, token: Schema.String },
			error: [ClientPageArtifactGrantNotFound.pipe(HttpApiSchema.status(404))],
		})
			.annotate(LogRouteTemplate, true)
			.annotate(OpenApi.Description, "Serves a file from a client page artifact grant"),
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
			.annotate(OpenApi.Description, "Resolves and prepares a client page target"),
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
