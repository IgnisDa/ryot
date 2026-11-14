import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";

export const LiveUpdatesGroup = HttpApiGroup.make("live-updates")
	.annotate(OpenApi.Description, "Pushes refresh hints to the signed-in user's open clients.")
	.add(
		HttpApiEndpoint.get("events", "/events").annotate(
			OpenApi.Description,
			"Server-sent `entity-updated` and `derived-data-updated` frames. Reconnect and refetch on loss.",
		),
	)
	.middleware(AuthMiddleware);
