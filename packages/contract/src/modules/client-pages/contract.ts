import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import {
	ClientPageSessionNotFound,
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

export const ClientPageArtifactsGroup = HttpApiGroup.make("clientPageArtifacts").add(
	HttpApiEndpoint.get("file", "/client-pages/artifacts/:token/:fileName", {
		params: { token: Schema.String, fileName: Schema.String },
		error: [ClientPageSessionNotFound.pipe(HttpApiSchema.status(404))],
	}),
);

export const ClientPagesGroup = HttpApiGroup.make("clientPages")
	.annotate(OpenApi.Description, "Authors renderers and prepares client pages")
	.add(
		HttpApiEndpoint.post("createRenderer", "/client-renderers", {
			payload: CreateClientRendererBody,
			success: ClientRendererRecord.pipe(HttpApiSchema.status(201)),
			error: [ClientRendererBadRequest.pipe(HttpApiSchema.status(400))],
		}),
	)
	.add(
		HttpApiEndpoint.get("listRenderers", "/client-renderers", {
			success: Schema.Array(ClientRendererMetadata),
		}),
	)
	.add(
		HttpApiEndpoint.get("getRenderer", "/client-renderers/:rendererId", {
			success: ClientRendererRecord,
			params: { rendererId: Schema.String },
			error: [ClientRendererNotFound.pipe(HttpApiSchema.status(404))],
		}),
	)
	.add(
		HttpApiEndpoint.put("replaceRendererDraft", "/client-renderers/:rendererId/draft", {
			error: rendererErrors,
			success: ClientRendererRecord,
			params: { rendererId: Schema.String },
			payload: ReplaceClientRendererDraftBody,
		}),
	)
	.add(
		HttpApiEndpoint.post("publishRenderer", "/client-renderers/:rendererId/publish", {
			error: rendererErrors,
			payload: PublishClientRendererBody,
			params: { rendererId: Schema.String },
			success: PublishClientRendererResponse,
		}),
	)
	.add(
		HttpApiEndpoint.delete("deleteRenderer", "/client-renderers/:rendererId", {
			error: rendererErrors,
			success: ClientRendererRecord,
			params: { rendererId: Schema.String },
		}),
	)
	.add(
		HttpApiEndpoint.post("prepare", "/client-pages/prepare", {
			error: rendererErrors,
			success: PreparedClientPage,
			payload: PrepareClientPageBody,
		}),
	)
	.add(
		HttpApiEndpoint.post("createSession", "/client-pages/sessions", {
			payload: CreateClientPageSessionBody,
			error: [ClientPageStalePreparation.pipe(HttpApiSchema.status(409))],
			success: CreateClientPageSessionResponse.pipe(HttpApiSchema.status(201)),
		}),
	)
	.add(
		HttpApiEndpoint.post("renewSession", "/client-pages/sessions/:sessionId/renew", {
			params: { sessionId: Schema.String },
			success: RenewClientPageSessionResponse,
			error: [ClientPageSessionNotFound.pipe(HttpApiSchema.status(404))],
		}),
	)
	.add(
		HttpApiEndpoint.delete("revokeSession", "/client-pages/sessions/:sessionId", {
			success: Schema.Void,
			params: { sessionId: Schema.String },
			error: [ClientPageSessionNotFound.pipe(HttpApiSchema.status(404))],
		}),
	)
	.middleware(AuthMiddleware);
