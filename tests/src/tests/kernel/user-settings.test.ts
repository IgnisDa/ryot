import { Effect } from "effect";

import {
	createAuthenticatedClient,
	getUserSettings,
	refreshUserAvatar,
	updateUserSettingsPreferences,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

describe("user settings", () => {
	it.live("reads and updates the current user's preferences", () =>
		Effect.gen(function* () {
			const { client, email, userId } = yield* createAuthenticatedClient();
			const initial = yield* getUserSettings(client);

			expect(initial.id).toBe(userId);
			expect(initial.email).toBe(email);
			expect(initial.name).toBe("Test User");
			expect(initial.preferences).toEqual({
				language: null,
				allowNsfw: false,
				disableIntegrations: false,
			});

			yield* updateUserSettingsPreferences(client, { allowNsfw: true, language: "es" });

			expect((yield* getUserSettings(client)).preferences).toEqual({
				language: "es",
				allowNsfw: true,
				disableIntegrations: false,
			});
		}),
	);

	it.live("generates and exposes a new profile avatar", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const refreshed = yield* refreshUserAvatar(client);

			expect(refreshed.image.startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect((yield* getUserSettings(client)).image).toBe(refreshed.image);
		}),
	);
});
