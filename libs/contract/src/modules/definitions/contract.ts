import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { PluginSlug } from "../../schema/brands";
import {
	EntityDefinition,
	ListedWorkspace,
	RelationshipDefinition,
	UpdateWorkspaceStateBody,
} from "./schemas";

const pluginSlugParam = HttpApiSchema.param("pluginSlug", PluginSlug);

export const DefinitionsGroup = HttpApiGroup.make("definitions")
	.annotate(OpenApi.Description, "Reads installed definitions and plugin workspaces.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("listEntities", "/definitions/entities")
			.annotate(OpenApi.Description, "List installed entity definitions.")
			.addSuccess(Schema.Array(EntityDefinition)),
	)
	.add(
		HttpApiEndpoint.get("listRelationships", "/definitions/relationships")
			.annotate(OpenApi.Description, "List installed relationship definitions.")
			.addSuccess(Schema.Array(RelationshipDefinition)),
	)
	.add(
		HttpApiEndpoint.get("listWorkspaces", "/definitions/workspaces")
			.annotate(OpenApi.Description, "List plugin workspaces with per-user state.")
			.setUrlParams(
				Schema.Struct({
					includeDisabled: Schema.optionalWith(Schema.BooleanFromString, { default: () => false }),
				}),
			)
			.addSuccess(Schema.Array(ListedWorkspace)),
	)
	.add(
		HttpApiEndpoint.patch("updateWorkspaceState")`/definitions/workspaces/${pluginSlugParam}`
			.annotate(OpenApi.Description, "Update a plugin workspace's per-user state.")
			.setPayload(UpdateWorkspaceStateBody)
			.addSuccess(ListedWorkspace)
			.addError(NotFound, { status: 404 }),
	);
