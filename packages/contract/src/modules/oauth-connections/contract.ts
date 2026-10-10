import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { LogRouteTemplate } from "../../http-annotations";
import { OAuthConnectionId } from "../../schema/brands";
import {
	CompleteOAuthConnectionBody,
	CreateOAuthConnectionBody,
	CreateOAuthConnectionResponse,
	OAuthConnectionCallbackQuery,
	OAuthConnectionNotFoundError,
	OAuthConnectionRequestError,
	OAuthConnectionState,
} from "./schemas";

export const OAuthConnectionsGroup = HttpApiGroup.make("oauthConnections")
	.annotate(OpenApi.Description, "Link external accounts to integration settings through OAuth.")
	.add(
		AuthenticatedMutationEndpoint.post("protected")("create", "/oauth-connections", {
			payload: CreateOAuthConnectionBody,
			error: [OAuthConnectionRequestError.pipe(HttpApiSchema.status(400))],
			success: CreateOAuthConnectionResponse.pipe(HttpApiSchema.status(201)),
		}).annotate(
			OpenApi.Description,
			"Start an OAuth connection for an integration settings field and return its authorization URL.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")(
			"complete",
			"/oauth-connections/:connectionId/complete",
			{
				payload: CompleteOAuthConnectionBody,
				params: { connectionId: OAuthConnectionId },
				success: Schema.Struct({ id: OAuthConnectionId }),
				error: [
					OAuthConnectionRequestError.pipe(HttpApiSchema.status(400)),
					OAuthConnectionNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Complete an authorized OAuth connection with its one-time completion secret.",
		),
	)
	.add(
		HttpApiEndpoint.get("status", "/oauth-connections/:connectionId", {
			success: OAuthConnectionState,
			params: { connectionId: OAuthConnectionId },
			error: [OAuthConnectionNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Read the status of one of the caller's OAuth connections."),
	)
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get(
			"callback",
			"/oauth-connections/providers/:pluginSlug/:oauthProviderSlug/callback",
			{
				query: OAuthConnectionCallbackQuery,
				params: { pluginSlug: Schema.String, oauthProviderSlug: Schema.String },
			},
		)
			.annotate(LogRouteTemplate, true)
			.annotate(
				OpenApi.Description,
				"Receive an OAuth provider redirect and forward the browser to the connection return page.",
			),
	);
