import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest } from "../../errors";
import { UpdateUserPreferencesBody, UserPreferences } from "./schemas";

export const UserPreferencesGroup = HttpApiGroup.make("userPreferences")
	.annotate(OpenApi.Description, "Manage user preferences.")
	.add(
		HttpApiEndpoint.patch("update", "/user-preferences", {
			payload: UpdateUserPreferencesBody,
			success: UserPreferences,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Update the user's preferences."),
	)
	.middleware(AuthMiddleware);
