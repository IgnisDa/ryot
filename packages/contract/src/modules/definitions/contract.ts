import { Schema, Effect, SchemaGetter } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { PluginSlug } from "../../schema/brands";
import {
	EntityDefinition,
	ListedPlugin,
	RelationshipDefinition,
	UpdatePluginStateBody,
} from "./schemas";

export const DefinitionsGroup = HttpApiGroup.make("definitions")
	.annotate(OpenApi.Description, "Reads installed definitions and plugins.")
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
		HttpApiEndpoint.get("listPlugins", "/definitions/plugins", {
			success: Schema.Array(ListedPlugin),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
			query: {
				includeDisabled: Schema.Boolean.pipe(
					(schema) =>
						Schema.optional(schema).pipe(
							Schema.decodeTo(Schema.toType(schema), {
								encode: SchemaGetter.required(),
								decode: SchemaGetter.withDefault(Effect.sync(() => false)),
							}),
						),
					Schema.withConstructorDefault(Effect.sync(() => false)),
				),
			},
		}).annotate(OpenApi.Description, "List installed plugins with per-user state."),
	)
	.add(
		HttpApiEndpoint.patch("updatePluginState", "/definitions/plugins/:pluginSlug", {
			success: ListedPlugin,
			payload: UpdatePluginStateBody,
			params: { pluginSlug: PluginSlug },
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Update a plugin's per-user state."),
	)
	.middleware(AuthMiddleware);
