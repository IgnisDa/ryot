import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
import {
	CreateSavedViewBody,
	SavedViewCommandResponse,
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
			error: [SavedViewBadRequest.pipe(HttpApiSchema.status(400))],
			success: SavedViewCommandResponse.pipe(HttpApiSchema.status(201)),
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Creates a saved view"),
	)
	.add(
		HttpApiEndpoint.put("update", "/saved-views/:viewSlug", {
			payload: UpdateSavedViewBody,
			success: SavedViewCommandResponse,
			params: { viewSlug: Schema.String },
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Updates a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.delete("delete", "/saved-views/:viewSlug", {
			success: SavedViewCommandResponse,
			params: { viewSlug: Schema.String },
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Deletes a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.post("clone", "/saved-views/:viewSlug/clone", {
			params: { viewSlug: Schema.String },
			success: SavedViewCommandResponse.pipe(HttpApiSchema.status(201)),
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Clones a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/saved-views/reorder", {
			payload: ReorderSavedViewsBody,
			success: ReorderSavedViewsResponse,
			error: [SavedViewBadRequest.pipe(HttpApiSchema.status(400))],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Reorders saved views"),
	)
	.middleware(AuthMiddleware);
