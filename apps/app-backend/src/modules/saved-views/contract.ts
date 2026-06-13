import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "#lib/errors";
import { TrackerId } from "#lib/schema/brands";

import {
	CreateSavedViewBody,
	ListedSavedView,
	ReorderSavedViewsBody,
	ReorderSavedViewsResponse,
	UpdateSavedViewBody,
} from "./schemas";

const viewSlugParam = HttpApiSchema.param("viewSlug", Schema.String);

export const SavedViewsGroup = HttpApiGroup.make("savedViews")
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
			.addSuccess(Schema.Array(ListedSavedView)),
	)
	.add(
		HttpApiEndpoint.post("create", "/saved-views")
			.setPayload(CreateSavedViewBody)
			.addSuccess(ListedSavedView, { status: 201 }),
	)
	.add(
		HttpApiEndpoint.get("get")`/saved-views/${viewSlugParam}`
			.addSuccess(ListedSavedView)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.put("update")`/saved-views/${viewSlugParam}`
			.setPayload(UpdateSavedViewBody)
			.addSuccess(ListedSavedView)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("delete")`/saved-views/${viewSlugParam}`
			.addSuccess(ListedSavedView)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("clone")`/saved-views/${viewSlugParam}/clone`
			.addSuccess(ListedSavedView, { status: 201 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/saved-views/reorder")
			.setPayload(ReorderSavedViewsBody)
			.addSuccess(ReorderSavedViewsResponse),
	);
