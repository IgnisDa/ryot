import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware, AuthRateLimited, AuthUnauthorized } from "../../auth-middleware";
import { PluginSlug } from "../../schema/brands";
import {
	InstallPluginBody,
	PluginConflictError,
	PluginInstallationItem,
	PluginInstallationList,
	PluginInvocationError,
	PluginInvokeBody,
	PluginInvokeResult,
	PluginNotFoundError,
	PluginRequestError,
	UpdatePrivatePluginBody,
} from "./schemas";

export const PluginArtifactsGroup = HttpApiGroup.make("pluginArtifacts")
	.annotate(OpenApi.Description, "Serves public plugin client artifacts.")
	.add(
		HttpApiEndpoint.get("artifact", "/plugins/artifacts/:artifactHash/:fileName", {
			success: HttpApiSchema.StreamUint8Array(),
			params: { artifactHash: Schema.String, fileName: Schema.String },
		}).annotate(OpenApi.Description, "Serves a plugin client artifact file."),
	);

export const PluginsGroup = HttpApiGroup.make("plugins")
	.annotate(OpenApi.Description, "Manages installed plugins for this instance.")
	.add(
		HttpApiEndpoint.get("list", "/plugins", {
			success: PluginInstallationList,
		}).annotate(OpenApi.Description, "Lists the caller's plugin installations."),
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
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("invoke", "/plugins/:pluginSlug/operations/:operationSlug", {
			payload: PluginInvokeBody,
			success: PluginInvokeResult,
			params: { pluginSlug: PluginSlug, operationSlug: Schema.String },
			error: [
				AuthUnauthorized.pipe(HttpApiSchema.status(401)),
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
