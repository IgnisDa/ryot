import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "../../errors";
import { TrackerId } from "../../schema/brands";
import {
	CreateTrackerBody,
	ListedTracker,
	ReorderTrackersBody,
	ReorderTrackersResponse,
	UpdateTrackerBody,
} from "./schemas";

const trackerIdParam = HttpApiSchema.param("trackerId", TrackerId);

export const TrackersGroup = HttpApiGroup.make("trackers")
	.annotate(OpenApi.Description, "Manages user trackers and their ordering.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("list", "/trackers")
			.annotate(OpenApi.Description, "Lists trackers, optionally including disabled trackers.")
			.setUrlParams(
				Schema.Struct({
					includeDisabled: Schema.optionalWith(Schema.BooleanFromString, {
						default: () => false,
					}),
				}),
			)
			.addSuccess(Schema.Array(ListedTracker)),
	)
	.add(
		HttpApiEndpoint.post("create", "/trackers")
			.annotate(OpenApi.Description, "Creates a tracker.")
			.setPayload(CreateTrackerBody)
			.addSuccess(ListedTracker, { status: 201 })
			.addError(Conflict, { status: 409 }),
	)
	.add(
		HttpApiEndpoint.patch("update")`/trackers/${trackerIdParam}`
			.annotate(OpenApi.Description, "Updates a tracker.")
			.setPayload(UpdateTrackerBody)
			.addSuccess(ListedTracker)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/trackers/reorder")
			.annotate(OpenApi.Description, "Reorders the user's trackers.")
			.setPayload(ReorderTrackersBody)
			.addSuccess(ReorderTrackersResponse),
	);
