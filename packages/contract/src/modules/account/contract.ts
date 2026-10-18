import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { UpdateUserPreferencesBody } from "./schemas";

export const AccountGroup = HttpApiGroup.make("account")
	.annotate(OpenApi.Description, "Manage the current user's settings.")
	.add(
		AuthenticatedMutationEndpoint.patch("protected")("updatePreferences", "/account/preferences", {
			payload: UpdateUserPreferencesBody,
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		}).annotate(OpenApi.Description, "Update the current user's preferences."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("refreshAvatar", "/account/avatar", {
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		}).annotate(OpenApi.Description, "Generate a new profile avatar for the current user."),
	)
	.middleware(AuthMiddleware);
