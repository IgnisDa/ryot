import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import type {
	UpdateUserPreferencesBody,
	UserPreferences,
} from "@ryot/contract/modules/user-settings/schemas";
import { Context, Effect, Layer } from "effect";

import { AuthService } from "#modules/auth/service";
import { generateUserAvatar } from "#modules/auth/user-avatar";

export class UserSettingsService extends Context.Service<UserSettingsService>()(
	"UserSettingsService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;

			const updatePreferences = Effect.fn("UserSettingsService.updatePreferences")(function* (
				user: CurrentUserValue,
				body: UpdateUserPreferencesBody,
			) {
				const next: UserPreferences = {
					allowNsfw: body.allowNsfw ?? user.preferences.allowNsfw,
					language: body.language !== undefined ? body.language : user.preferences.language,
					disableIntegrations: body.disableIntegrations ?? user.preferences.disableIntegrations,
				};

				yield* auth.updateUserPreferences(user.id, next);

				return next;
			});
			const refreshAvatar = Effect.fn("UserSettingsService.refreshAvatar")(function* (
				user: CurrentUserValue,
			) {
				const image = generateUserAvatar(crypto.randomUUID());
				yield* auth.updateUserImage(user.id, image);
				return { image };
			});

			return { refreshAvatar, updatePreferences };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
