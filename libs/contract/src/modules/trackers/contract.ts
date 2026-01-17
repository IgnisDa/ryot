import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { ListedTracker, UpdateTrackerStateBody } from "./schemas";

const trackerSlugParam = HttpApiSchema.param("trackerSlug", Schema.String);

export const TrackersGroup = HttpApiGroup.make("trackers")
	.annotate(OpenApi.Description, "Reads tracker definitions with per-user state.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.get("list", "/trackers")
			.annotate(OpenApi.Description, "List tracker definitions with per-user state.")
			.setUrlParams(
				Schema.Struct({
					includeDisabled: Schema.optionalWith(Schema.BooleanFromString, { default: () => false }),
				}),
			)
			.addSuccess(Schema.Array(ListedTracker)),
	)
	.add(
		HttpApiEndpoint.patch("updateState")`/trackers/${trackerSlugParam}`
			.annotate(OpenApi.Description, "Update a tracker's per-user state.")
			.setPayload(UpdateTrackerStateBody)
			.addSuccess(ListedTracker)
			.addError(NotFound, { status: 404 }),
	);
