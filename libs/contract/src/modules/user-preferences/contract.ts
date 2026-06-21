import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { AuthMiddleware } from "../../auth-middleware";
import { RateLimited, Unauthorized } from "../../errors";
import { UpdateUserPreferencesBody, UserPreferences } from "./schemas";

export const UserPreferencesGroup = HttpApiGroup.make("userPreferences")
	.annotate(OpenApi.Description, "Manage user preferences.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.patch("update", "/user-preferences")
			.annotate(OpenApi.Description, "Update the user's preferences.")
			.setPayload(UpdateUserPreferencesBody)
			.addSuccess(UserPreferences),
	);
