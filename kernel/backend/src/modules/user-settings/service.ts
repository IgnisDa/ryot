import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type {
	UpdateUserPreferencesBody,
	UserPreferences,
} from "@ryot-app/contract/modules/user-settings/schemas";
import { Context, Effect, Layer } from "effect";

import { AuthService } from "#modules/auth/service";
import { generateUserAvatar } from "#modules/auth/user-avatar";

import { UserSettingsRepository } from "./repository";

export class UserSettingsService extends Context.Service<UserSettingsService>()(
	"UserSettingsService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			const repository = yield* UserSettingsRepository;

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
			});
			const refreshAvatar = Effect.fn("UserSettingsService.refreshAvatar")(function* (
				user: CurrentUserValue,
			) {
				const image = generateUserAvatar(crypto.randomUUID());
				yield* auth.updateUserImage(user.id, image);
			});

			const getTwoFactorStatus = Effect.fn("UserSettingsService.getTwoFactorStatus")(function* (
				user: CurrentUserValue,
			) {
				const state = yield* repository.findTwoFactorState(user.id);
				return {
					enabled: state.twoFactorEnabled === true,
					available: state.accounts.some((account) => account.providerId === "credential"),
				};
			});

			return { refreshAvatar, updatePreferences, getTwoFactorStatus };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
