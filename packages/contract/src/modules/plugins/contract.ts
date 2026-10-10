import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import {
	AuthMiddleware,
	AuthRateLimited,
	AuthUnauthorized,
	DemoOperationProtected,
	UserInitializing,
} from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { PluginSlug, UserId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import {
	InstallPluginBody,
	PluginInstallResult,
	PluginConflictError,
	PluginHomeViewSelection,
	PluginInstallationWriteResult,
	PluginInvocationError,
	PluginInvokeBody,
	PluginInvokeResult,
	PluginNotFoundError,
	PluginRequestError,
	UpdatePluginInstallationBody,
	UpdatePrivatePluginBody,
} from "./schemas";

export const PLUGIN_CATALOG_CONNECTED_EVENT = "connected";
export const PLUGIN_CATALOG_INVALIDATED_EVENT = "catalog-invalidated";
export const PluginCatalogEventStream = HttpApiSchema.StreamUint8Array({
	contentType: "text/event-stream",
});

export const PluginCatalogInvalidatedMessage = Schema.Struct({ userId: UserId });
export type PluginCatalogInvalidatedMessage = typeof PluginCatalogInvalidatedMessage.Type;

export const decodePluginCatalogInvalidatedMessage = Schema.decodeUnknownResult(
	Schema.fromJsonString(PluginCatalogInvalidatedMessage),
	{ onExcessProperty: "error" },
);
export const encodePluginCatalogInvalidatedMessage = Schema.encodeSync(
	Schema.fromJsonString(PluginCatalogInvalidatedMessage),
	{ onExcessProperty: "error" },
);

export const PluginsGroup = HttpApiGroup.make("plugins")
	.annotate(OpenApi.Description, "Manages installed plugins for this instance.")
	.add(
		HttpApiEndpoint.get("events", "/plugins/events", {
			success: PluginCatalogEventStream,
		}).annotate(OpenApi.Description, "Streams plugin catalog events for the caller."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("install", "/plugins", {
			payload: InstallPluginBody,
			success: PluginInstallResult.pipe(HttpApiSchema.status(201)),
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
		AuthenticatedMutationEndpoint.put("protected")("update", "/plugins/:pluginSlug", {
			payload: UpdatePrivatePluginBody,
			params: { pluginSlug: PluginSlug },
			success: PluginInstallationWriteResult,
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
		AuthenticatedMutationEndpoint.delete("protected")(
			"uninstall",
			"/plugins/:pluginSlug/:activationId",
			{
				success: PluginInstallationWriteResult,
				params: { pluginSlug: PluginSlug, activationId: Schema.String },
				error: [
					PluginConflictError.pipe(HttpApiSchema.status(409)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Uninstalls the caller's private plugin unless a workflow or persistent resource still references it.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("protected")(
			"updatePluginState",
			"/plugins/:pluginSlug/state",
			{
				params: { pluginSlug: PluginSlug },
				payload: UpdatePluginInstallationBody,
				success: PluginInstallationWriteResult,
				error: [
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
					PluginConflictError.pipe(HttpApiSchema.status(409)),
				],
			},
		).annotate(OpenApi.Description, "Update the caller's plugin installation."),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")(
			"setHomeView",
			"/plugins/:pluginSlug/home-view",
			{
				payload: PluginHomeViewSelection,
				success: PluginHomeViewSelection,
				params: { pluginSlug: PluginSlug },
				error: [
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Sets or clears the caller's plugin home saved view."),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")(
			"saveUserSettings",
			"/plugins/installations/:installationId/user-settings",
			{
				params: { installationId: Schema.String },
				payload: Schema.Record(Schema.String, JsonValue),
				success: Schema.Void.pipe(HttpApiSchema.status(204)),
				error: [
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Saves the caller's settings for a plugin installation."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")(
			"resetUserSettings",
			"/plugins/installations/:installationId/user-settings",
			{
				params: { installationId: Schema.String },
				success: Schema.Void.pipe(HttpApiSchema.status(204)),
				error: [
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Resets the caller's settings for a plugin installation to defaults.",
		),
	)
	.middleware(AuthMiddleware)
	.add(
		// Operation manifests enforce their own demo access when invoked.
		AuthenticatedMutationEndpoint.post("allowed")(
			"invoke",
			"/plugins/:pluginSlug/operations/:operationSlug",
			{
				payload: PluginInvokeBody,
				success: PluginInvokeResult,
				params: { pluginSlug: PluginSlug, operationSlug: Schema.String },
				error: [
					AuthUnauthorized.pipe(HttpApiSchema.status(401)),
					DemoOperationProtected.pipe(HttpApiSchema.status(403)),
					PluginConflictError.pipe(HttpApiSchema.status(409)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					AuthRateLimited.pipe(HttpApiSchema.status(429)),
					UserInitializing.pipe(HttpApiSchema.status(503)),
					PluginInvocationError.pipe(HttpApiSchema.status(502)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Invokes a named plugin operation as a synchronous sandbox execution, enforcing the operation's declared authentication mode.",
		),
	);
