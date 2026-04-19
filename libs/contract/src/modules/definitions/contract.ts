import { Schema, Effect, SchemaGetter } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { PluginSlug } from "../../schema/brands";
import {
	EntityDefinition,
	ListedWorkspace,
	RelationshipDefinition,
	UpdateWorkspaceStateBody,
} from "./schemas";

export const DefinitionsGroup = HttpApiGroup.make("definitions")
	.annotate(OpenApi.Description, "Reads installed definitions and plugin workspaces.")
	.add(
		HttpApiEndpoint.get("listEntities", "/definitions/entities", {
			success: Schema.Array(EntityDefinition),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "List installed entity definitions."),
	)
	.add(
		HttpApiEndpoint.get("listRelationships", "/definitions/relationships", {
			success: Schema.Array(RelationshipDefinition),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "List installed relationship definitions."),
	)
	.add(
		HttpApiEndpoint.get("listWorkspaces", "/definitions/workspaces", {
			query: {
				includeDisabled: Schema.Boolean.pipe(
					(schema) =>
						Schema.optional(schema).pipe(
							Schema.decodeTo(Schema.toType(schema), {
								decode: SchemaGetter.withDefault(Effect.sync(() => false)),
								encode: SchemaGetter.required(),
							}),
						),
					Schema.withConstructorDefault(Effect.sync(() => false)),
				),
			},
			success: Schema.Array(ListedWorkspace),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "List plugin workspaces with per-user state."),
	)
	.add(
		HttpApiEndpoint.patch("updateWorkspaceState", "/definitions/workspaces/:pluginSlug", {
			params: { pluginSlug: PluginSlug },
			payload: UpdateWorkspaceStateBody,
			success: ListedWorkspace,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Update a plugin workspace's per-user state."),
	)
	.middleware(AuthMiddleware);
