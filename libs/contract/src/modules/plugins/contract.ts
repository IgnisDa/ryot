import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AdminMiddleware } from "../../auth-middleware";
import { BadRequest, Conflict, NotFound, Unauthorized } from "../../errors";
import { InstallPluginBody, PluginList, PluginListItem } from "./schemas";

const pluginSlugParam = HttpApiSchema.param("pluginSlug", Schema.String);

export const PluginsGroup = HttpApiGroup.make("plugins")
	.annotate(OpenApi.Description, "Manages installed plugins for this instance.")
	.addError(Unauthorized, { status: 401 })
	.middleware(AdminMiddleware)
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
	);
