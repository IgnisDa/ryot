import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AdminMiddleware } from "../../auth-middleware";
import {
	BadRequest,
	Conflict,
	NotFound,
	RateLimited,
	SandboxRunError,
	Unauthorized,
} from "../../errors";
import { PluginSlug } from "../../schema/brands";
import {
	InstallPluginBody,
	PluginInvokeBody,
	PluginInvokeResult,
	PluginList,
	PluginListItem,
} from "./schemas";

export const PluginsGroup = HttpApiGroup.make("plugins")
	.annotate(OpenApi.Description, "Manages installed plugins for this instance.")
	.add(
		HttpApiEndpoint.get("list", "/plugins", {
			success: PluginList,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Lists active plugins."),
	)
	.add(
		HttpApiEndpoint.post("install", "/plugins", {
			payload: InstallPluginBody,
			success: PluginListItem.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(
			OpenApi.Description,
			"Validates, compiles, and installs a plugin from a manifest and source file map.",
		),
	)
	.add(
		HttpApiEndpoint.delete("uninstall", "/plugins/:pluginSlug", {
			params: { pluginSlug: PluginSlug },
			success: PluginListItem,
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				Conflict.pipe(HttpApiSchema.status(409)),
				NotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(
			OpenApi.Description,
			"Uninstalls a plugin unless it is boot-configured or its entity schemas are referenced.",
		),
	)
	.middleware(AdminMiddleware)
	.add(
		HttpApiEndpoint.post("invoke", "/plugins/:pluginSlug/operations/:operationSlug", {
			params: { pluginSlug: PluginSlug, operationSlug: Schema.String },
			payload: PluginInvokeBody,
			success: PluginInvokeResult,
			error: [
				Unauthorized.pipe(HttpApiSchema.status(401)),
				NotFound.pipe(HttpApiSchema.status(404)),
				BadRequest.pipe(HttpApiSchema.status(400)),
				RateLimited.pipe(HttpApiSchema.status(429)),
				SandboxRunError.pipe(HttpApiSchema.status(502)),
			],
		}).annotate(
			OpenApi.Description,
			"Invokes a named plugin operation as a synchronous sandbox execution, enforcing the operation's declared authentication mode.",
		),
	);
