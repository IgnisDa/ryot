import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
import { PluginSlug } from "../../schema/brands";
import {
	PluginConflictError,
	PluginInstallationItem,
	PluginNotFoundError,
	PluginRequestError,
} from "../plugins/schemas";
import { EntityDefinition, RelationshipDefinition, UpdatePluginStateBody } from "./schemas";

export const DefinitionsGroup = HttpApiGroup.make("definitions")
	.annotate(OpenApi.Description, "Reads installed definitions.")
	.add(
		HttpApiEndpoint.get("listEntities", "/definitions/entities", {
			success: Schema.Array(EntityDefinition),
		}).annotate(OpenApi.Description, "List installed entity definitions."),
	)
	.add(
		HttpApiEndpoint.get("listRelationships", "/definitions/relationships", {
			success: Schema.Array(RelationshipDefinition),
		}).annotate(OpenApi.Description, "List installed relationship definitions."),
	)
	.add(
		HttpApiEndpoint.patch("updatePluginState", "/definitions/plugins/:pluginSlug", {
			payload: UpdatePluginStateBody,
			success: PluginInstallationItem,
			params: { pluginSlug: PluginSlug },
			error: [
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Update the caller's plugin installation."),
	)
	.middleware(AuthMiddleware);
