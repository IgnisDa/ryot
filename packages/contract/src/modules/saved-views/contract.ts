import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
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
		AuthenticatedMutationEndpoint.post("protected")("create", "/saved-views", {
			payload: CreateSavedViewBody,
			error: [SavedViewBadRequest.pipe(HttpApiSchema.status(400))],
			success: SavedViewCommandResponse.pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Creates a saved view"),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")("update", "/saved-views/:viewSlug", {
			payload: UpdateSavedViewBody,
			success: SavedViewCommandResponse,
			params: { viewSlug: Schema.String },
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Updates a saved view by slug"),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")("delete", "/saved-views/:viewSlug", {
			success: SavedViewCommandResponse,
			params: { viewSlug: Schema.String },
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Deletes a saved view by slug"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("clone", "/saved-views/:viewSlug/clone", {
			params: { viewSlug: Schema.String },
			success: SavedViewCommandResponse.pipe(HttpApiSchema.status(201)),
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Clones a saved view by slug"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("reorder", "/saved-views/reorder", {
			payload: ReorderSavedViewsBody,
			success: ReorderSavedViewsResponse,
			error: [SavedViewBadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Reorders saved views"),
	)
	.middleware(AuthMiddleware);
