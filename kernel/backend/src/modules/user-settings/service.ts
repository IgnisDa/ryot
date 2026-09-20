import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/user-settings/schemas";
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
				if (Object.keys(body).length === 0) {
					return;
				}
				yield* auth.updateUserPreferences(user.id, {
					...body,
					...(body.language === undefined
						? {}
						: { language: body.language === null ? null : body.language.trim() || null }),
				});
			});
			const refreshAvatar = Effect.fn("UserSettingsService.refreshAvatar")(function* (
				user: CurrentUserValue,
			) {
				const image = generateUserAvatar(crypto.randomUUID());
				yield* auth.updateUserImage(user.id, image);
			});

			return { refreshAvatar, updatePreferences };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
