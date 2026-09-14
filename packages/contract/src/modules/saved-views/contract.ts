import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	ReorderSavedViewsResponse,
	SavedViewBadRequest,
	SavedViewNotFound,
	UpdateSavedViewBody,
} from "./schemas";

export const SavedViewsGroup = HttpApiGroup.make("savedViews")
	.annotate(OpenApi.Description, "Manages saved views")
	.add(
		HttpApiEndpoint.post("create", "/saved-views", {
			payload: CreateSavedViewBody,
			success: ListedSavedView.pipe(HttpApiSchema.status(201)),
			error: [SavedViewBadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates a saved view"),
	)
	.add(
		HttpApiEndpoint.put("update", "/saved-views/:viewSlug", {
			success: ListedSavedView,
			payload: UpdateSavedViewBody,
			params: { viewSlug: Schema.String },
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Updates a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.delete("delete", "/saved-views/:viewSlug", {
			success: ListedSavedView,
			params: { viewSlug: Schema.String },
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Deletes a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.post("clone", "/saved-views/:viewSlug/clone", {
			params: { viewSlug: Schema.String },
			success: ListedSavedView.pipe(HttpApiSchema.status(201)),
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Clones a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/saved-views/reorder", {
			payload: ReorderSavedViewsBody,
			success: ReorderSavedViewsResponse,
			error: [SavedViewBadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Reorders saved views"),
	)
	.middleware(AuthMiddleware);
