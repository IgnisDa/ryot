import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import type {
	UpdateUserPreferencesBody,
	UserPreferences,
} from "@ryot/contract/modules/user-preferences/schemas";
import { Context, Effect, Layer } from "effect";

import { AuthService } from "#modules/auth/service";

export class UserPreferencesService extends Context.Service<UserPreferencesService>()(
	"UserPreferencesService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;

			const update = Effect.fn("UserPreferencesService.update")(function* (
				user: CurrentUserValue,
				body: UpdateUserPreferencesBody,
			) {
				const next: UserPreferences = {
					isNsfw: body.isNsfw ?? user.preferences.isNsfw,
					language: body.language !== undefined ? body.language : user.preferences.language,
					disableIntegrations: body.disableIntegrations ?? user.preferences.disableIntegrations,
				};

				yield* auth.updateUserPreferences(user.id, next);

				return next;
			});

			return { update };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
