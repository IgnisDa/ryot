import { Schema, Effect, SchemaGetter } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { PluginSlug } from "../../schema/brands";
import {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	ReorderSavedViewsResponse,
	UpdateSavedViewBody,
} from "./schemas";

export const SavedViewsGroup = HttpApiGroup.make("savedViews")
	.annotate(OpenApi.Description, "Manages saved views")
	.add(
		HttpApiEndpoint.get("list", "/saved-views", {
			query: {
				pluginSlug: Schema.optional(PluginSlug),
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
			success: Schema.Array(ListedSavedView),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Lists saved views with optional plugin and status filters"),
	)
	.add(
		HttpApiEndpoint.post("create", "/saved-views", {
			payload: CreateSavedViewBody,
			success: ListedSavedView.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates a saved view"),
	)
	.add(
		HttpApiEndpoint.get("get", "/saved-views/:viewSlug", {
			params: { viewSlug: Schema.String },
			success: ListedSavedView,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Gets a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.put("update", "/saved-views/:viewSlug", {
			params: { viewSlug: Schema.String },
			payload: UpdateSavedViewBody,
			success: ListedSavedView,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Updates a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.delete("delete", "/saved-views/:viewSlug", {
			params: { viewSlug: Schema.String },
			success: ListedSavedView,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Deletes a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.post("clone", "/saved-views/:viewSlug/clone", {
			params: { viewSlug: Schema.String },
			success: ListedSavedView.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Clones a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/saved-views/reorder", {
			payload: ReorderSavedViewsBody,
			success: ReorderSavedViewsResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Reorders saved views"),
	)
	.middleware(AuthMiddleware);
