import { Effect, Schema } from "effect";

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
import { webRequest } from "~/support/web-request";

describe("user settings", () => {
	it.live("reads and updates the current user's preferences", () =>
		Effect.gen(function* () {
			const { email, client, userId } = yield* createAuthenticatedClient();
			const initial = yield* getUserSettings(client);

			expect(initial.id).toBe(userId);
			expect(initial.email).toBe(email);
			expect(initial.name).toBe("Test User");
			expect(initial.preferences).toEqual({ language: null, disableIntegrations: false });

			yield* updateUserSettingsPreferences(client, { language: "es", disableIntegrations: true });

			expect((yield* getUserSettings(client)).preferences).toEqual({
				language: "es",
				disableIntegrations: true,
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

	it.live("keeps warm auth sessions separate from atomic application preferences", () =>
		Effect.gen(function* () {
			const { token, client, sessionCookie } = yield* createAuthenticatedClient();
			const apiUrl = getApiUrl();
			const session = () =>
				webRequest(`${apiUrl}/auth/get-session`, { headers: { Cookie: sessionCookie } });
			const warm = yield* session();
			expect(warm.status).toBe(200);
			const warmBody: unknown = yield* Effect.promise(() => warm.json());
			expect(warmBody).not.toHaveProperty("user.preferences");

			yield* updateUserSettingsPreferences(client, { language: "  fr  " });
			expect((yield* getUserSettings(client)).preferences.language).toBe("fr");
			yield* updateUserSettingsPreferences(client, { disableIntegrations: true });
			yield* updateUserSettingsPreferences(client, { language: null });
			expect((yield* getUserSettings(client)).preferences).toEqual({
				language: null,
				disableIntegrations: true,
			});
			const refreshed = yield* session();
			expect(refreshed.status).toBe(200);
			const refreshedBody: unknown = yield* Effect.promise(() => refreshed.json());
			expect(refreshedBody).not.toHaveProperty("user.preferences");

			for (const payload of [
				{ language: ["fr"] },
				{ language: { value: "fr" } },
				{ disableIntegrations: "true" },
				{ unknownField: true },
			]) {
				const response = yield* webRequest(`${apiUrl}/user-settings/preferences`, {
					method: "PATCH",
					body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(payload),
					headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				});
				expect(response.status).toBe(400);
			}

			const rawAuth = yield* webRequest(`${apiUrl}/auth/update-user`, {
				method: "POST",
				headers: {
					Cookie: sessionCookie,
					Origin: new URL(apiUrl).origin,
					"content-type": "application/json",
				},
				body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
					preferences: { disableIntegrations: false },
				}),
			});
			expect(rawAuth.status).toBeLessThan(500);
			expect((yield* getUserSettings(client)).preferences.disableIntegrations).toBe(true);
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
