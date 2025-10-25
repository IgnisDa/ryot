import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "#lib/errors";
import { TrackerId } from "#lib/schema/brands";

import {
	CreateTrackerBody,
	ListedTracker,
	ReorderTrackersBody,
	ReorderTrackersResponse,
	UpdateTrackerBody,
} from "./schemas";

const trackerIdParam = HttpApiSchema.param("trackerId", TrackerId);

export const TrackersGroup = HttpApiGroup.make("trackers")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("list", "/trackers")
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
			.setPayload(CreateTrackerBody)
			.addSuccess(ListedTracker, { status: 201 })
			.addError(Conflict, { status: 409 }),
	)
	.add(
		HttpApiEndpoint.patch("update")`/trackers/${trackerIdParam}`
			.setPayload(UpdateTrackerBody)
			.addSuccess(ListedTracker)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("reorder", "/trackers/reorder")
			.setPayload(ReorderTrackersBody)
			.addSuccess(ReorderTrackersResponse),
	);
