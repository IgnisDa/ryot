import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { BadRequest, Conflict, NotFound, RateLimited, Unauthorized } from "../../lib/errors";
import {
	CreateTrackerBody,
	ListedTracker,
	ReorderTrackersBody,
	ReorderTrackersResponse,
	UpdateTrackerBody,
} from "./schemas";

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
			.addError(BadRequest, { status: 400 })
			.addError(Conflict, { status: 409 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.patch("update")`/trackers/${trackerIdParam}`
			.setPayload(UpdateTrackerBody)
			.addSuccess(ListedTracker)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/trackers/reorder")
			.setPayload(ReorderTrackersBody)
			.addSuccess(ReorderTrackersResponse)
			.addError(BadRequest, { status: 400 })
			.middleware(AuthMiddleware),
	);
