import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { strictStruct } from "../../schema/utils";
import { SavedViewReference } from "../plugins/references";
import { RyotQLBadRequest } from "../ryotql/contract";
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
			success: SavedViewCommandResponse.pipe(HttpApiSchema.status(201)),
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				RyotQLBadRequest.pipe(HttpApiSchema.status(400)),
			],
		}).annotate(OpenApi.Description, "Creates a saved view"),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")("update", "/saved-views", {
			success: SavedViewCommandResponse,
			payload: strictStruct({ reference: SavedViewReference, ...UpdateSavedViewBody.fields }),
			error: [
				RyotQLBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Updates an exact saved view"),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")("delete", "/saved-views", {
			success: SavedViewCommandResponse,
			payload: strictStruct({ reference: SavedViewReference }),
			error: [
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Deletes a custom saved view"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("clone", "/saved-views/clone", {
			payload: strictStruct({ reference: SavedViewReference }),
			success: SavedViewCommandResponse.pipe(HttpApiSchema.status(201)),
			error: [
				RyotQLBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewBadRequest.pipe(HttpApiSchema.status(400)),
				SavedViewNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Clones an exact saved view"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("reorder", "/saved-views/reorder", {
			payload: ReorderSavedViewsBody,
			success: ReorderSavedViewsResponse,
			error: [SavedViewBadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Reorders saved views"),
	)
	.middleware(AuthMiddleware);
