import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy, LogRouteTemplate } from "../../http-annotations";
import {
	ClientPageArtifactGrantNotFound,
	ClientPagePreparationError,
	ClientRendererBadRequest,
	ClientRendererCommandResponse,
	ClientRendererNotFound,
	CheckClientPageFreshnessBody,
	CheckClientPageFreshnessResponse,
	CreateClientRendererBody,
	PrepareClientPageBody,
	PreparedClientPage,
	PublishClientRendererBody,
	PublishClientRendererResponse,
	ReplaceClientRendererDraftBody,
	ReplaceClientRendererDraftResponse,
} from "./schemas";

const rendererErrors = [
	ClientRendererBadRequest.pipe(HttpApiSchema.status(400)),
	ClientRendererNotFound.pipe(HttpApiSchema.status(404)),
] as const;

export const ClientPageArtifactsGroup = HttpApiGroup.make("clientPageArtifacts")
	.annotate(OpenApi.Description, "Serves files from authenticated client page artifact grants")
	.add(
		HttpApiEndpoint.get("file", "/client-pages/artifacts/:token/:fileName", {
			params: { token: Schema.String, fileName: Schema.String },
			error: [ClientPageArtifactGrantNotFound.pipe(HttpApiSchema.status(404))],
		})
			.annotate(LogRouteTemplate, true)
			.annotate(OpenApi.Description, "Serves a file from a client page artifact grant"),
	);

export const ClientPagesGroup = HttpApiGroup.make("clientPages")
	.annotate(OpenApi.Description, "Authors renderers and prepares client pages")
	.add(
		HttpApiEndpoint.post("createRenderer", "/client-renderers", {
			payload: CreateClientRendererBody,
			error: [ClientRendererBadRequest.pipe(HttpApiSchema.status(400))],
			success: ClientRendererCommandResponse.pipe(HttpApiSchema.status(201)),
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Creates an owned client renderer draft"),
	)
	.add(
		HttpApiEndpoint.put("replaceRendererDraft", "/client-renderers/:rendererId/draft", {
			error: rendererErrors,
			params: { rendererId: Schema.String },
			payload: ReplaceClientRendererDraftBody,
			success: ReplaceClientRendererDraftResponse,
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Replaces a client renderer draft"),
	)
	.add(
		HttpApiEndpoint.post("publishRenderer", "/client-renderers/:rendererId/publish", {
			error: rendererErrors,
			payload: PublishClientRendererBody,
			params: { rendererId: Schema.String },
			success: PublishClientRendererResponse,
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Publishes a client renderer draft"),
	)
	.add(
		HttpApiEndpoint.delete("deleteRenderer", "/client-renderers/:rendererId", {
			error: rendererErrors,
			params: { rendererId: Schema.String },
			success: ClientRendererCommandResponse,
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Deletes an owned client renderer"),
	)
	.add(
		HttpApiEndpoint.post("prepare", "/client-pages/prepare", {
			success: PreparedClientPage,
			payload: PrepareClientPageBody,
			error: [...rendererErrors, ClientPagePreparationError.pipe(HttpApiSchema.status(404))],
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
