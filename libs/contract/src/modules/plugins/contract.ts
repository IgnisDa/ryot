import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

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

const pluginSlugParam = HttpApiSchema.param("pluginSlug", PluginSlug);
const operationSlugParam = HttpApiSchema.param("operationSlug", Schema.String);

export const PluginsGroup = HttpApiGroup.make("plugins")
	.annotate(OpenApi.Description, "Manages installed plugins for this instance.")
	.addError(Unauthorized, { status: 401 })
	.add(
		HttpApiEndpoint.get("list", "/plugins")
			.addSuccess(PluginList)
			.annotate(OpenApi.Description, "Lists active plugins."),
	)
	.add(
		HttpApiEndpoint.post("install", "/plugins")
			.setPayload(InstallPluginBody)
			.addSuccess(PluginListItem, { status: 201 })
			.addError(BadRequest, { status: 400 })
			.annotate(
				OpenApi.Description,
				"Validates, compiles, and installs a plugin from a manifest and source file map.",
			),
	)
	.add(
		HttpApiEndpoint.del("uninstall")`/plugins/${pluginSlugParam}`
			.addSuccess(PluginListItem)
			.addError(Conflict, { status: 409 })
			.addError(NotFound, { status: 404 })
			.annotate(
				OpenApi.Description,
				"Uninstalls a plugin unless it is boot-configured or its entity schemas are referenced.",
			),
	)
	.middlewareEndpoints(AdminMiddleware)
	.add(
		HttpApiEndpoint.post("invoke")`/plugins/${pluginSlugParam}/operations/${operationSlugParam}`
			.setPayload(PluginInvokeBody)
			.addSuccess(PluginInvokeResult)
			.addError(NotFound, { status: 404 })
			.addError(BadRequest, { status: 400 })
			.addError(RateLimited, { status: 429 })
			.addError(SandboxRunError, { status: 502 })
			.annotate(
				OpenApi.Description,
				"Invokes a named plugin operation as a synchronous sandbox execution, enforcing the operation's declared authentication mode.",
			),
	);
