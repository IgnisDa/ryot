import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy, LogRouteTemplate } from "../../http-annotations";
import {
	ClientPageSessionNotFound,
	ClientPagePreparationError,
	ClientPageStalePreparation,
	ClientRendererBadRequest,
	ClientRendererMetadata,
	ClientRendererNotFound,
	ClientRendererRecord,
	CreateClientPageSessionBody,
	CreateClientPageSessionResponse,
	CreateClientRendererBody,
	PrepareClientPageBody,
	PreparedClientPage,
	PublishClientRendererBody,
	PublishClientRendererResponse,
	RenewClientPageSessionResponse,
	ReplaceClientRendererDraftBody,
} from "./schemas";

const rendererErrors = [
	ClientRendererBadRequest.pipe(HttpApiSchema.status(400)),
	ClientRendererNotFound.pipe(HttpApiSchema.status(404)),
] as const;

export const ClientPageArtifactsGroup = HttpApiGroup.make("clientPageArtifacts")
	.annotate(OpenApi.Description, "Serves files from authenticated client page artifact sessions")
	.add(
		HttpApiEndpoint.get("file", "/client-pages/artifacts/:token/:fileName", {
			params: { token: Schema.String, fileName: Schema.String },
			error: [ClientPageSessionNotFound.pipe(HttpApiSchema.status(404))],
		})
			.annotate(LogRouteTemplate, true)
			.annotate(OpenApi.Description, "Serves a file from a client page artifact session"),
	);

export const ClientPagesGroup = HttpApiGroup.make("clientPages")
	.annotate(OpenApi.Description, "Authors renderers and prepares client pages")
	.add(
		HttpApiEndpoint.post("createRenderer", "/client-renderers", {
			payload: CreateClientRendererBody,
			success: ClientRendererRecord.pipe(HttpApiSchema.status(201)),
			error: [ClientRendererBadRequest.pipe(HttpApiSchema.status(400))],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Creates an owned client renderer draft"),
	)
	.add(
		HttpApiEndpoint.get("listRenderers", "/client-renderers", {
			success: Schema.Array(ClientRendererMetadata),
		}).annotate(OpenApi.Description, "Lists owned client renderers"),
	)
	.add(
		HttpApiEndpoint.get("getRenderer", "/client-renderers/:rendererId", {
			success: ClientRendererRecord,
			params: { rendererId: Schema.String },
			error: [ClientRendererNotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Inspects an owned client renderer"),
	)
	.add(
		HttpApiEndpoint.put("replaceRendererDraft", "/client-renderers/:rendererId/draft", {
			error: rendererErrors,
			success: ClientRendererRecord,
			params: { rendererId: Schema.String },
			payload: ReplaceClientRendererDraftBody,
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
			success: ClientRendererRecord,
			params: { rendererId: Schema.String },
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
		HttpApiEndpoint.post("createSession", "/client-pages/sessions", {
			payload: CreateClientPageSessionBody,
			error: [ClientPageStalePreparation.pipe(HttpApiSchema.status(409))],
			success: CreateClientPageSessionResponse.pipe(HttpApiSchema.status(201)),
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Creates an authenticated client page session"),
	)
	.add(
		HttpApiEndpoint.post("renewSession", "/client-pages/sessions/:sessionId/renew", {
			params: { sessionId: Schema.String },
			success: RenewClientPageSessionResponse,
			error: [
				ClientPageStalePreparation.pipe(HttpApiSchema.status(409)),
				ClientPageSessionNotFound.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Renews a client page session"),
	)
	.add(
		HttpApiEndpoint.delete("revokeSession", "/client-pages/sessions/:sessionId", {
			success: Schema.Void,
			params: { sessionId: Schema.String },
			error: [ClientPageSessionNotFound.pipe(HttpApiSchema.status(404))],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Revokes a client page session"),
	)
	.middleware(AuthMiddleware);
