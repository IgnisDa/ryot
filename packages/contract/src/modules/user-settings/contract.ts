import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { UpdateUserPreferencesBody, UserAvatar, UserPreferences, UserSettings } from "./schemas";

export const UserSettingsGroup = HttpApiGroup.make("userSettings")
	.annotate(OpenApi.Description, "Manage the current user's settings.")
	.add(
		HttpApiEndpoint.get("get", "/user-settings", {
			success: UserSettings,
		}).annotate(OpenApi.Description, "Get the current user's settings."),
	)
	.add(
		HttpApiEndpoint.patch("updatePreferences", "/user-settings/preferences", {
			success: UserPreferences,
			payload: UpdateUserPreferencesBody,
		}).annotate(OpenApi.Description, "Update the current user's preferences."),
	)
	.add(
		HttpApiEndpoint.post("refreshAvatar", "/user-settings/avatar", {
			success: UserAvatar,
		}).annotate(OpenApi.Description, "Generate a new profile avatar for the current user."),
	)
	.middleware(AuthMiddleware);
