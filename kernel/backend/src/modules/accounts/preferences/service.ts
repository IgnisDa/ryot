import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { UserPreferencesPatch } from "@ryot-app/contract/schema/user-preferences";
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
				if (Object.keys(patch).length === 0) {
					return;
				}
				yield* auth.updateUserPreferences(user.id, {
					...patch,
					...(patch.language === undefined
						? {}
						: { language: patch.language === null ? null : patch.language.trim() || null }),
				});
			});
			const refreshAvatar = Effect.fn("UserSettingsService.refreshAvatar")(function* (
				user: CurrentUserValue,
			) {
				const image = generateUserAvatar(yield* random.uuidV4());
				yield* auth.updateUserImage(user.id, image);
			});
			return { refreshAvatar, updatePreferences };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
