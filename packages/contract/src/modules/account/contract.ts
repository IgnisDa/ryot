import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { ApiKeyId } from "../../schema/brands";
import { UserPreferencesPatch } from "../../schema/user-preferences";
import { AccountName, CreateApiKeyBody, CreatedApiKey } from "./schemas";

export const AccountGroup = HttpApiGroup.make("account")
	.annotate(OpenApi.Description, "Manage the current user's settings.")
	.add(
		AuthenticatedMutationEndpoint.patch("protected")("rename", "/account/name", {
			payload: Schema.Struct({ name: AccountName }),
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		}).annotate(OpenApi.Description, "Change the current user's display name."),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("protected")("updatePreferences", "/account/preferences", {
			payload: UserPreferencesPatch,
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		}).annotate(OpenApi.Description, "Update the current user's preferences."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("refreshAvatar", "/account/avatar", {
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		}).annotate(OpenApi.Description, "Generate a new profile avatar for the current user."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("createApiKey", "/account/api-keys", {
			payload: CreateApiKeyBody,
			success: CreatedApiKey.pipe(HttpApiSchema.status(201)),
		}).annotate(
			OpenApi.Description,
			"Create an API key for the current user. The key is returned only in this response.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")(
			"revokeApiKey",
			"/account/api-keys/:apiKeyId",
			{ params: { apiKeyId: ApiKeyId }, success: Schema.Void.pipe(HttpApiSchema.status(204)) },
		).annotate(OpenApi.Description, "Revoke one of the current user's API keys."),
	)
	.middleware(AuthMiddleware);
