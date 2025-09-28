import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, RateLimited, Unauthorized } from "../../lib/errors";

export const ListedSavedView = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isBuiltin: Schema.Boolean,
	isDisabled: Schema.Boolean,
	sortOrder: Schema.Number,
	accentColor: Schema.String,
	queryDefinition: Schema.Unknown,
	displayConfiguration: Schema.Unknown,
	trackerId: Schema.optional(Schema.String),
});

const CreateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	accentColor: Schema.String,
	queryDefinition: Schema.Unknown,
	displayConfiguration: Schema.Unknown,
	trackerId: Schema.optional(Schema.String),
});

const UpdateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	isDisabled: Schema.Boolean,
	accentColor: Schema.String,
	queryDefinition: Schema.Unknown,
	displayConfiguration: Schema.Unknown,
	trackerId: Schema.optional(Schema.String),
});

const ReorderSavedViewsBody = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
	trackerId: Schema.optional(Schema.String),
});

const ReorderSavedViewsResponse = Schema.Struct({ viewSlugs: Schema.Array(Schema.String) });

const viewSlugParam = HttpApiSchema.param("viewSlug", Schema.String);

export const SavedViewsGroup = HttpApiGroup.make("saved-views")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.get("list", "/saved-views")
			.setUrlParams(
				Schema.Struct({
					trackerId: Schema.optional(Schema.String),
					includeDisabled: Schema.optionalWith(Schema.BooleanFromString, {
						default: () => false,
					}),
				}),
			)
			.addSuccess(Schema.Array(ListedSavedView))
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/saved-views")
			.setPayload(CreateSavedViewBody)
			.addSuccess(ListedSavedView, { status: 201 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("get")`/saved-views/${viewSlugParam}`
			.addSuccess(ListedSavedView)
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.put("update")`/saved-views/${viewSlugParam}`
			.setPayload(UpdateSavedViewBody)
			.addSuccess(ListedSavedView)
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.del("delete")`/saved-views/${viewSlugParam}`
			.addSuccess(ListedSavedView)
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("clone")`/saved-views/${viewSlugParam}/clone`
			.addSuccess(ListedSavedView, { status: 201 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/saved-views/reorder")
			.setPayload(ReorderSavedViewsBody)
			.addSuccess(ReorderSavedViewsResponse)
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
