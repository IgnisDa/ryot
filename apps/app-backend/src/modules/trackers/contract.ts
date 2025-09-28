import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { Conflict, NotFound, NotImplemented, RateLimited, Unauthorized } from "../../lib/errors";

export const ListedTracker = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	config: Schema.Unknown,
	isBuiltin: Schema.Boolean,
	isDisabled: Schema.Boolean,
	sortOrder: Schema.Number,
	accentColor: Schema.String,
	description: Schema.optional(Schema.String),
});

const CreateTrackerBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	accentColor: Schema.String,
	slug: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
});

const UpdateTrackerBody = Schema.Struct({
	isDisabled: Schema.Boolean,
	icon: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	accentColor: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
});

const ReorderTrackersBody = Schema.Struct({ trackerIds: Schema.Array(Schema.String) });
const ReorderTrackersResponse = Schema.Struct({ trackerIds: Schema.Array(Schema.String) });

const trackerIdParam = HttpApiSchema.param("trackerId", Schema.String);

export const TrackersGroup = HttpApiGroup.make("trackers")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.get("list", "/trackers")
			.setUrlParams(
				Schema.Struct({
					includeDisabled: Schema.optionalWith(Schema.BooleanFromString, {
						default: () => false,
					}),
				}),
			)
			.addSuccess(Schema.Array(ListedTracker))
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/trackers")
			.setPayload(CreateTrackerBody)
			.addSuccess(ListedTracker, { status: 201 })
			.addError(Conflict, { status: 409 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.patch("update")`/trackers/${trackerIdParam}`
			.setPayload(UpdateTrackerBody)
			.addSuccess(ListedTracker)
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/trackers/reorder")
			.setPayload(ReorderTrackersBody)
			.addSuccess(ReorderTrackersResponse)
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
