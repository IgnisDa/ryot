import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { badRequest } from "@ryot-app/contract/errors";
import type { CreateApiKeyBody } from "@ryot-app/contract/modules/account/schemas";
import type { ApiKeyId, ConnectedAppId } from "@ryot-app/contract/schema/brands";
import type { UserPreferencesPatch } from "@ryot-app/contract/schema/user-preferences";
import { canonicalLocale, languageOfLocale } from "@ryot-app/i18n/locale";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { canonicalLanguageCode } from "@ryot-app/languages";
import { Context, Effect, Layer } from "effect";
import { SecureRandom } from "effect/crypto";

import { AuthService } from "#modules/accounts/auth/service";
import { generateUserAvatar } from "#modules/accounts/auth/user-avatar";

export class UserSettingsService extends Context.Service<UserSettingsService>()(
	"@ryot-app/kernel-backend/modules/accounts/preferences/service/UserSettingsService",
	{
		make: Effect.gen(function* () {
			const random = yield* SecureRandom.SecureRandom;
			const auth = yield* AuthService;

			const updatePreferences = Effect.fn("UserSettingsService.updatePreferences")(function* (
				user: CurrentUserValue,
				patch: UserPreferencesPatch,
			) {
				const contentLanguage =
					typeof patch.contentLanguage === "string"
						? canonicalLocale(patch.contentLanguage)
						: patch.contentLanguage;
				if (
					(contentLanguage === undefined && patch.contentLanguage !== undefined) ||
					(typeof contentLanguage === "string" &&
						canonicalLanguageCode(languageOfLocale(contentLanguage)) === undefined)
				) {
					return yield* badRequest(kernelMessage("error.accounts.unknown-content-language"));
				}
				return yield* Object.keys(patch).length === 0
					? Effect.void
					: auth.updateUserPreferences(user.id, {
							...patch,
							...(contentLanguage === undefined ? {} : { contentLanguage }),
						});
			});
			const rename = Effect.fn("UserSettingsService.rename")(function* (
				user: CurrentUserValue,
				name: string,
			) {
				yield* auth.updateUserName(user.id, name);
			});
			const refreshAvatar = Effect.fn("UserSettingsService.refreshAvatar")(function* (
				user: CurrentUserValue,
			) {
				const image = generateUserAvatar(yield* random.uuidV4());
				yield* auth.updateUserImage(user.id, image);
			});
			const createApiKey = Effect.fn("UserSettingsService.createApiKey")(function* (
				user: CurrentUserValue,
				input: CreateApiKeyBody,
			) {
				return yield* auth.createUserApiKey(user.id, input);
			});
			const revokeApiKey = Effect.fn("UserSettingsService.revokeApiKey")(function* (
				user: CurrentUserValue,
				apiKeyId: ApiKeyId,
			) {
				yield* auth.revokeUserApiKey(user.id, apiKeyId);
			});
			const revokeConnectedApp = Effect.fn("UserSettingsService.revokeConnectedApp")(function* (
				user: CurrentUserValue,
				connectedAppId: ConnectedAppId,
			) {
				yield* auth.revokeUserConnectedApp(user.id, connectedAppId);
			});
			return {
				rename,
				revokeApiKey,
				createApiKey,
				refreshAvatar,
				updatePreferences,
				revokeConnectedApp,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
