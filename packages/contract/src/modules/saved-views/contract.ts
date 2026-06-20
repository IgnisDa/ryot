import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	ReorderSavedViewsResponse,
	SearchSavedViewEntitiesBody,
	SearchSavedViewEntitiesResponse,
	UpdateSavedViewBody,
} from "./schemas";

export const SavedViewsGroup = HttpApiGroup.make("savedViews")
	.annotate(OpenApi.Description, "Manages saved views")
	.add(
		HttpApiEndpoint.post("create", "/saved-views", {
			payload: CreateSavedViewBody,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
			success: ListedSavedView.pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Creates a saved view"),
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
		HttpApiEndpoint.post("searchEntities", "/saved-views/:viewSlug/entity-search", {
			params: { viewSlug: Schema.String },
			payload: SearchSavedViewEntitiesBody,
			success: SearchSavedViewEntitiesResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Searches configured entity providers for a saved view"),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/saved-views/reorder", {
			payload: ReorderSavedViewsBody,
			success: ReorderSavedViewsResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Reorders saved views"),
	)
	.middleware(AuthMiddleware);
