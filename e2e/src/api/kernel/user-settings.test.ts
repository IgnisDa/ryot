import {
	ACCOUNT_NAME_MAX_LENGTH,
	API_KEY_MAX_EXPIRY_DAYS,
	API_KEY_NAME_MAX_LENGTH,
} from "@ryot-app/contract/modules/account/schemas";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { Clock, Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	enableTwoFactorForSessionEffect,
	getApiKeys,
	getTwoFactorStatus,
	getUserSettings,
	refreshUserAvatar,
	updateUserSettingsPreferences,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl, getSharedHarnessTarget } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

describe("user settings", () => {
	it.live("renames only the authenticated account and rejects invalid names", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const before = yield* getUserSettings(owner.client);
			yield* owner.client.call((c) => c.account.rename({ payload: { name: "Renée 新" } }));
			const trimmed = yield* webRequest(`${getApiUrl()}/account/name`, {
				method: "PATCH",
				headers: { "content-type": "application/json", authorization: `Bearer ${owner.token}` },
				body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
					name: "  Renée 新  ",
				}),
			});
			expect(trimmed.status).toBe(204);
			const after = yield* getUserSettings(owner.client);
			expect(after).toEqual({ ...before, name: "Renée 新" });
			expect((yield* getUserSettings(other.client)).name).toBe("Test User");
			const info = yield* webRequest(`${getApiUrl()}/auth/oauth2/userinfo`, {
				headers: { authorization: `Bearer ${owner.token}` },
			});
			expect(info.status).toBe(200);
			expect(yield* Effect.promise(() => info.json())).toMatchObject({ name: "Renée 新" });
			for (const name of ["", "   ", "x".repeat(ACCOUNT_NAME_MAX_LENGTH + 1), null]) {
				const response = yield* webRequest(`${getApiUrl()}/account/name`, {
					method: "PATCH",
					body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({ name }),
					headers: { "content-type": "application/json", authorization: `Bearer ${owner.token}` },
				});
				expect(response.status).toBe(400);
			}
			expect((yield* getUserSettings(owner.client)).name).toBe("Renée 新");
		}),
	);

	it.live("creates, lists, authenticates with and revokes only the owner's API keys", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
			const created = yield* owner.client.call((c) =>
				c.account.createApiKey({ payload: { name: "Scripts", expiresInDays: 30 } }),
			);
			const permanent = yield* owner.client.call((c) =>
				c.account.createApiKey({ payload: { name: "Sync", expiresInDays: null } }),
			);
			const keys = (yield* getApiKeys(owner.client)).items;
			expect(
				keys.map(({ id, name, start, lastUsedAt }) => ({ id, name, start, lastUsedAt })),
			).toEqual([
				{ name: "Sync", lastUsedAt: null, id: permanent.id, start: permanent.key.slice(0, 6) },
				{ id: created.id, name: "Scripts", lastUsedAt: null, start: created.key.slice(0, 6) },
			]);
			expect(keys.find(({ id }) => id === permanent.id)?.expiresAt).toBeNull();
			const expiresAt = keys.find(({ id }) => id === created.id)?.expiresAt;
			expect(Date.parse(expiresAt ?? "") - (yield* Clock.currentTimeMillis)).toBeGreaterThan(
				29 * 24 * 60 * 60 * 1000,
			);
			expect((yield* getApiKeys(other.client)).items).toEqual([]);

			const useKey = (key: string) =>
				Effect.gen(function* () {
					const response = yield* webRequest(`${getApiUrl()}/account/preferences`, {
						method: "PATCH",
						body: yield* encode({}),
						headers: { "x-api-key": key, "content-type": "application/json" },
					});
					return response.status;
				});
			expect(yield* useKey(created.key)).toBe(204);
			yield* other.client.call((c) => c.account.revokeApiKey({ params: { apiKeyId: created.id } }));
			expect(yield* useKey(created.key)).toBe(204);
			yield* owner.client.call((c) => c.account.revokeApiKey({ params: { apiKeyId: created.id } }));
			expect(yield* useKey(created.key)).toBe(401);
			expect(yield* useKey(permanent.key)).toBe(204);
			expect((yield* getApiKeys(owner.client)).items.map(({ id }) => id)).toEqual([permanent.id]);

			for (const payload of [
				{ name: "   ", expiresInDays: null },
				{ expiresInDays: null, name: "x".repeat(API_KEY_NAME_MAX_LENGTH + 1) },
				{ name: "Key", expiresInDays: 0 },
				{ name: "Key", expiresInDays: API_KEY_MAX_EXPIRY_DAYS + 1 },
				{ name: "Key", expiresInDays: 1.5 },
			]) {
				const response = yield* webRequest(`${getApiUrl()}/account/api-keys`, {
					method: "POST",
					body: yield* encode(payload),
					headers: { "content-type": "application/json", authorization: `Bearer ${owner.token}` },
				});
				expect(response.status).toBe(400);
			}
		}),
	);

	it.live("reads and updates the current user's preferences", () =>
		Effect.gen(function* () {
			const { email, client, userId } = yield* createAuthenticatedClient();
			const initial = yield* getUserSettings(client);

			expect(initial.id).toBe<unknown>(userId);
			expect(initial.email).toBe(email);
			expect(initial.name).toBe("Test User");
			expect(initial.preferences).toEqual({
				language: null,
				ratingScale: "hundred",
				disableIntegrations: false,
				reportingTimeZone: TimeZone.make("UTC"),
			});

			yield* updateUserSettingsPreferences(client, {
				language: "es",
				ratingScale: "five",
				disableIntegrations: true,
			});

			expect((yield* getUserSettings(client)).preferences).toEqual({
				language: "es",
				ratingScale: "five",
				disableIntegrations: true,
				reportingTimeZone: TimeZone.make("UTC"),
			});
		}),
	);

	it.live("validates reporting time zones and keeps preference updates account-scoped", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const defaultPreferences = {
				language: null,
				disableIntegrations: false,
				ratingScale: "hundred" as const,
				reportingTimeZone: TimeZone.make("UTC"),
			};
			expect((yield* getUserSettings(other.client)).preferences).toEqual(defaultPreferences);

			yield* updateUserSettingsPreferences(owner.client, {
				reportingTimeZone: TimeZone.make("Asia/Kolkata"),
			});
			yield* updateUserSettingsPreferences(owner.client, { language: "fr" });
			expect((yield* getUserSettings(owner.client)).preferences).toEqual({
				language: "fr",
				ratingScale: "hundred",
				disableIntegrations: false,
				reportingTimeZone: TimeZone.make("Asia/Kolkata"),
			});

			expect((yield* getUserSettings(other.client)).preferences).toEqual(defaultPreferences);
		}),
	);

	it.live("stores a valid sign-up reporting time zone and defaults others to UTC", () =>
		Effect.gen(function* () {
			const target = getSharedHarnessTarget();
			const tokyo = yield* createAuthenticatedClient(target, "Asia/Tokyo");
			expect((yield* getUserSettings(tokyo.client)).preferences.reportingTimeZone).toBe(
				TimeZone.make("Asia/Tokyo"),
			);
			const invalid = yield* createAuthenticatedClient(target, "+05:30");
			expect((yield* getUserSettings(invalid.client)).preferences.reportingTimeZone).toBe(
				TimeZone.make("UTC"),
			);
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
				ratingScale: "hundred",
				disableIntegrations: true,
				reportingTimeZone: TimeZone.make("UTC"),
			});
			const refreshed = yield* session();
			expect(refreshed.status).toBe(200);
			const refreshedBody: unknown = yield* Effect.promise(() => refreshed.json());
			expect(refreshedBody).not.toHaveProperty("user.preferences");

			for (const payload of [
				{ language: ["fr"] },
				{ language: { value: "fr" } },
				{ disableIntegrations: "true" },
				{ ratingScale: "stars" },
				{ unknownField: true },
			]) {
				const response = yield* webRequest(`${apiUrl}/account/preferences`, {
					method: "PATCH",
					body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(payload),
					headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				});
				expect(response.status).toBe(400);
			}

			const nullZone = yield* webRequest(`${apiUrl}/account/preferences`, {
				method: "PATCH",
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
					reportingTimeZone: null,
				}),
			});
			expect(nullZone.status).toBe(204);
			expect((yield* getUserSettings(client)).preferences.reportingTimeZone).toBe(
				TimeZone.make("UTC"),
			);

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
