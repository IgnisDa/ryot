import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AdminMiddleware, AuthRateLimited, AuthUnauthorized } from "../../auth-middleware";
import { PluginSlug } from "../../schema/brands";
import {
	InstallPluginBody,
	PluginConflictError,
	PluginInvocationError,
	PluginInvokeBody,
	PluginInvokeResult,
	PluginList,
	PluginListItem,
	PluginNotFoundError,
	PluginRequestError,
} from "./schemas";

export const PluginsGroup = HttpApiGroup.make("plugins")
	.annotate(OpenApi.Description, "Manages installed plugins for this instance.")
	.add(
		HttpApiEndpoint.get("list", "/plugins", {
			success: PluginList,
		}).annotate(OpenApi.Description, "Lists active plugins."),
	)
	.add(
		HttpApiEndpoint.post("install", "/plugins", {
			payload: InstallPluginBody,
			success: PluginListItem.pipe(HttpApiSchema.status(201)),
			error: [PluginRequestError.pipe(HttpApiSchema.status(400))],
		}).annotate(
			OpenApi.Description,
			"Validates, compiles, and installs a plugin from a manifest and source file map.",
		),
	)
	.add(
		HttpApiEndpoint.delete("uninstall", "/plugins/:pluginSlug", {
			success: PluginListItem,
			params: { pluginSlug: PluginSlug },
			error: [
				PluginConflictError.pipe(HttpApiSchema.status(409)),
				PluginNotFoundError.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(
			OpenApi.Description,
			"Uninstalls a plugin unless it is boot-configured or its entity schemas are referenced.",
		),
	)
	.middleware(AdminMiddleware)
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
