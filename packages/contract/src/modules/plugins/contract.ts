import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware, AuthRateLimited, AuthUnauthorized } from "../../auth-middleware";
import { LogRouteTemplate } from "../../http-annotations";
import { PluginSlug, UserId } from "../../schema/brands";
import {
	CreatePluginClientArtifactSessionBody,
	CreatePluginClientArtifactSessionResponse,
	InstallPluginBody,
	PluginArtifactSessionNotFoundError,
	PluginArtifactSessionUnavailableError,
	PluginConflictError,
	PluginInstallationItem,
	PluginInstallationList,
	PluginInvocationError,
	PluginInvokeBody,
	PluginInvokeResult,
	PluginNotFoundError,
	PluginRequestError,
	RenewPluginClientArtifactSessionResponse,
	UpdatePrivatePluginBody,
} from "./schemas";

export const PLUGIN_CATALOG_CONNECTED_EVENT = "connected";
export const PLUGIN_CATALOG_INVALIDATED_EVENT = "catalog-invalidated";
export const PluginCatalogEventStream = HttpApiSchema.StreamUint8Array({
	contentType: "text/event-stream",
});

export const PluginCatalogInvalidatedMessage = Schema.Struct({
	userId: UserId,
});
export type PluginCatalogInvalidatedMessage = typeof PluginCatalogInvalidatedMessage.Type;

export const decodePluginCatalogInvalidatedMessage = Schema.decodeUnknownResult(
	Schema.fromJsonString(PluginCatalogInvalidatedMessage),
	{ onExcessProperty: "error" },
);
export const encodePluginCatalogInvalidatedMessage = Schema.encodeSync(
	Schema.fromJsonString(PluginCatalogInvalidatedMessage),
	{ onExcessProperty: "error" },
);

const pluginArtifactSessionErrors = [
	PluginArtifactSessionNotFoundError.pipe(HttpApiSchema.status(404)),
	PluginArtifactSessionUnavailableError.pipe(HttpApiSchema.status(503)),
] as const;

export const PluginArtifactSessionsGroup = HttpApiGroup.make("pluginArtifactSessions")
	.annotate(OpenApi.Description, "Serves files from private plugin artifact sessions.")
	.add(
		HttpApiEndpoint.get("file", "/plugin-artifact-sessions/:token/:fileName", {
			error: pluginArtifactSessionErrors,
			success: HttpApiSchema.StreamUint8Array(),
			params: { token: Schema.String, fileName: Schema.String },
		})
			.annotate(LogRouteTemplate, true)
			.annotate(OpenApi.Description, "Serves a file from a private plugin artifact session."),
	);

export const PluginsGroup = HttpApiGroup.make("plugins")
	.annotate(OpenApi.Description, "Manages installed plugins for this instance.")
	.add(
		HttpApiEndpoint.get("list", "/plugins", {
			success: PluginInstallationList,
		}).annotate(OpenApi.Description, "Lists the caller's plugin installations."),
	)
	.add(
		HttpApiEndpoint.get("events", "/plugins/events", {
			success: PluginCatalogEventStream,
		}).annotate(OpenApi.Description, "Streams plugin catalog events for the caller."),
	)
	.add(
		HttpApiEndpoint.post("install", "/plugins", {
			payload: InstallPluginBody,
			success: PluginInstallationItem.pipe(HttpApiSchema.status(201)),
			error: [
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(
			OpenApi.Description,
			"Validates, compiles, and installs a private plugin from a manifest, source file map, and initial config.",
		),
	)
	.add(
		HttpApiEndpoint.put("update", "/plugins/:pluginSlug", {
			success: PluginInstallationItem,
			payload: UpdatePrivatePluginBody,
			params: { pluginSlug: PluginSlug },
			error: [
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(
			OpenApi.Description,
			"Validates, compiles, and atomically replaces the caller's private plugin package.",
		),
	)
	.add(
		HttpApiEndpoint.delete("uninstall", "/plugins/:pluginSlug", {
			success: PluginInstallationItem,
			params: { pluginSlug: PluginSlug },
			error: [
				PluginConflictError.pipe(HttpApiSchema.status(409)),
				PluginNotFoundError.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(
			OpenApi.Description,
			"Uninstalls the caller's private plugin unless its definitions are still referenced.",
		),
	)
	.add(
		HttpApiEndpoint.post(
			"createArtifactSession",
			"/plugins/:pluginSlug/installations/:installationId/client-artifact-sessions",
			{
				payload: CreatePluginClientArtifactSessionBody,
				success: CreatePluginClientArtifactSessionResponse.pipe(HttpApiSchema.status(201)),
				params: { pluginSlug: PluginSlug, installationId: Schema.String },
				error: [
					...pluginArtifactSessionErrors,
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
					PluginConflictError.pipe(HttpApiSchema.status(409)),
				],
			},
		).annotate(OpenApi.Description, "Creates a short-lived private client artifact session."),
	)
	.add(
		HttpApiEndpoint.post(
			"renewArtifactSession",
			"/plugins/client-artifact-sessions/:sessionId/renew",
			{
				error: pluginArtifactSessionErrors,
				params: { sessionId: Schema.String },
				success: RenewPluginClientArtifactSessionResponse,
			},
		).annotate(OpenApi.Description, "Renews a private client artifact session."),
	)
	.add(
		HttpApiEndpoint.delete(
			"revokeArtifactSession",
			"/plugins/client-artifact-sessions/:sessionId",
			{
				params: { sessionId: Schema.String },
				success: Schema.Void.pipe(HttpApiSchema.status(204)),
				error: PluginArtifactSessionUnavailableError.pipe(HttpApiSchema.status(503)),
			},
		).annotate(OpenApi.Description, "Deletes a private client artifact session."),
	)
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("invoke", "/plugins/:pluginSlug/operations/:operationSlug", {
			payload: PluginInvokeBody,
			success: PluginInvokeResult,
			params: { pluginSlug: PluginSlug, operationSlug: Schema.String },
			error: [
				AuthUnauthorized.pipe(HttpApiSchema.status(401)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
				PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				AuthRateLimited.pipe(HttpApiSchema.status(429)),
				PluginInvocationError.pipe(HttpApiSchema.status(502)),
			],
		}).annotate(
			OpenApi.Description,
			"Invokes a named plugin operation as a synchronous sandbox execution, enforcing the operation's declared authentication mode.",
		),
	);
