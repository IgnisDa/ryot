import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { UpdateUserPreferencesBody } from "./schemas";

export const UserSettingsGroup = HttpApiGroup.make("userSettings")
	.annotate(OpenApi.Description, "Manage the current user's settings.")
	.add(
		AuthenticatedMutationEndpoint.patch("protected")(
			"updatePreferences",
			"/user-settings/preferences",
			{ payload: UpdateUserPreferencesBody, success: Schema.Void.pipe(HttpApiSchema.status(204)) },
		).annotate(OpenApi.Description, "Update the current user's preferences."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("refreshAvatar", "/user-settings/avatar", {
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		}).annotate(OpenApi.Description, "Generate a new profile avatar for the current user."),
	)
	.middleware(AuthMiddleware);
