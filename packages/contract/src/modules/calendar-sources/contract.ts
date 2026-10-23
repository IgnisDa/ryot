import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { CalendarSourceNotFound, SetCalendarSourceVisibilityBody } from "./schemas";

export const CalendarSourcesGroup = HttpApiGroup.make("calendarSources")
	.annotate(OpenApi.Description, "Manages per-user calendar source visibility")
	.add(
		AuthenticatedMutationEndpoint.put("protected")(
			"setVisibility",
			"/calendar-sources/visibility",
			{
				payload: SetCalendarSourceVisibilityBody,
				success: SetCalendarSourceVisibilityBody,
				error: CalendarSourceNotFound.pipe(HttpApiSchema.status(404)),
			},
		).annotate(OpenApi.Description, "Hides or shows one effective calendar source"),
	)
	.middleware(AuthMiddleware);
