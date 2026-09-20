import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enableTwoFactorForSessionEffect,
	getTwoFactorStatus,
	getUserSettings,
	refreshUserAvatar,
	updateUserSettingsPreferences,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

describe("user settings", () => {
	it.live("reads and updates the current user's preferences", () =>
		Effect.gen(function* () {
			const { email, client, userId } = yield* createAuthenticatedClient();
			const initial = yield* getUserSettings(client);

			expect(initial.id).toBe(userId);
			expect(initial.email).toBe(email);
			expect(initial.name).toBe("Test User");
			expect(initial.preferences).toEqual({
				language: null,
				allowNsfw: false,
				disableIntegrations: false,
			});

			yield* updateUserSettingsPreferences(client, { language: "es", allowNsfw: true });

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
			const before = (yield* getUserSettings(client)).image;
			yield* refreshUserAvatar(client);
			const image = (yield* getUserSettings(client)).image;

			expect(image?.startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect(image).not.toBe(before);
		}),
	);

	it.live("reports two-factor status for a password account", () =>
		Effect.gen(function* () {
			const { token, client, password, sessionCookie } = yield* createAuthenticatedClient();

			expect(yield* getTwoFactorStatus(client)).toEqual({ enabled: false, available: true });

			yield* enableTwoFactorForSessionEffect({
				token,
				password,
				sessionCookie,
				baseUrl: getApiUrl(),
			});

			expect(yield* getTwoFactorStatus(client)).toEqual({ enabled: true, available: true });
		}),
	);
});
