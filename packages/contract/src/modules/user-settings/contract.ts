import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
import { UpdateUserPreferencesBody } from "./schemas";

export const UserSettingsGroup = HttpApiGroup.make("userSettings")
	.annotate(OpenApi.Description, "Manage the current user's settings.")
	.add(
		HttpApiEndpoint.patch("updatePreferences", "/user-settings/preferences", {
			payload: UpdateUserPreferencesBody,
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Update the current user's preferences."),
	)
	.add(
		HttpApiEndpoint.post("refreshAvatar", "/user-settings/avatar", {
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Generate a new profile avatar for the current user."),
	)
	.middleware(AuthMiddleware);
