import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { TrackerId } from "../../schema/brands";
import {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	ReorderSavedViewsResponse,
	UpdateSavedViewBody,
} from "./schemas";

const viewSlugParam = HttpApiSchema.param("viewSlug", Schema.String);

export const SavedViewsGroup = HttpApiGroup.make("savedViews")
	.annotate(OpenApi.Description, "Manages saved tracker views")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("list", "/saved-views")
			.setUrlParams(
				Schema.Struct({
					trackerId: Schema.optional(TrackerId),
					includeDisabled: Schema.optionalWith(Schema.BooleanFromString, {
						default: () => false,
					}),
				}),
			)
			.addSuccess(Schema.Array(ListedSavedView))
			.annotate(OpenApi.Description, "Lists saved views with optional tracker and status filters"),
	)
	.add(
		HttpApiEndpoint.post("create", "/saved-views")
			.setPayload(CreateSavedViewBody)
			.addSuccess(ListedSavedView, { status: 201 })
			.annotate(OpenApi.Description, "Creates a saved view"),
	)
	.add(
		HttpApiEndpoint.get("get")`/saved-views/${viewSlugParam}`
			.addSuccess(ListedSavedView)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Gets a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.put("update")`/saved-views/${viewSlugParam}`
			.setPayload(UpdateSavedViewBody)
			.addSuccess(ListedSavedView)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Updates a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.del("delete")`/saved-views/${viewSlugParam}`
			.addSuccess(ListedSavedView)
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Deletes a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.post("clone")`/saved-views/${viewSlugParam}/clone`
			.addSuccess(ListedSavedView, { status: 201 })
			.addError(NotFound, { status: 404 })
			.annotate(OpenApi.Description, "Clones a saved view by slug"),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/saved-views/reorder")
			.setPayload(ReorderSavedViewsBody)
			.addSuccess(ReorderSavedViewsResponse)
			.annotate(OpenApi.Description, "Reorders saved views"),
	);
