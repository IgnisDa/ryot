import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";

import { AuthMiddleware } from "#lib/auth-middleware";
import { RateLimited, Unauthorized } from "#lib/errors";

import { UpdateUserPreferencesBody, UserPreferences } from "./schemas";

export const UserPreferencesGroup = HttpApiGroup.make("userPreferences")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.patch("update", "/user-preferences")
			.setPayload(UpdateUserPreferencesBody)
			.addSuccess(UserPreferences),
	);
