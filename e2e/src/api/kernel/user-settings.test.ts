import { Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
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

			yield* updateUserSettingsPreferences(client, { allowNsfw: true, language: "  fr  " });
			expect((yield* getUserSettings(client)).preferences.language).toBe("fr");
			yield* updateUserSettingsPreferences(client, { allowNsfw: false, disableIntegrations: true });
			yield* updateUserSettingsPreferences(client, { language: null });
			expect((yield* getUserSettings(client)).preferences).toEqual({
				language: null,
				allowNsfw: false,
				disableIntegrations: true,
			});
			const refreshed = yield* session();
			expect(refreshed.status).toBe(200);
			const refreshedBody: unknown = yield* Effect.promise(() => refreshed.json());
			expect(refreshedBody).not.toHaveProperty("user.preferences");

			for (const payload of [
				{ language: ["fr"] },
				{ language: { value: "fr" } },
				{ allowNsfw: "true" },
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
				body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
					preferences: { allowNsfw: true },
				}),
				headers: {
					Cookie: sessionCookie,
					Origin: new URL(apiUrl).origin,
					"content-type": "application/json",
				},
			});
			expect(rawAuth.status).toBeLessThan(500);
			expect((yield* getUserSettings(client)).preferences.allowNsfw).toBe(false);
		}),
	);
});
