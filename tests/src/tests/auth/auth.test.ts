import { Effect } from "effect";

import { createTestAuthClient, createTestUser, getBackendClient } from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("GET /system/config auth block defaults", () => {
	it.live("returns correct auth defaults", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const data = yield* client.call((c) => c.system.config());
			expect(data.auth.oidcEnabled).toBe(false);
			expect(data.auth.signupAllowed).toBe(true);
			expect(data.auth.localAuthDisabled).toBe(false);
			expect(data.auth.oidcButtonLabel).toBeUndefined();
		}),
	);
});

describe("Email sign-up", () => {
	it.live(
		"bootstraps a new user with tracker rows and default notification rules after sign-up",
		() =>
			Effect.gen(function* () {
				const { cookies } = yield* createTestUser();
				const headers = { Cookie: cookies };
				const trackers = yield* getBackendClient().call(
					(c) => c.trackers.list({ urlParams: { includeDisabled: true } }),
					headers,
				);
				expect(trackers.length).toBeGreaterThan(0);

				const [catalog, rules] = yield* Effect.all([
					getBackendClient().call((c) => c.automations.listCatalog(), headers),
					getBackendClient().call((c) => c.automations.listRules(), headers),
				]);
				expect(rules).toHaveLength(catalog.length);
				expect(rules.map((rule) => rule.signalSchema.id).sort()).toEqual(
					catalog.map((schema) => schema.id).sort(),
				);
				expect(rules.every((rule) => rule.isActive)).toBe(true);
			}),
	);

	it.live("returns an error for a duplicate email sign-up", () =>
		Effect.gen(function* () {
			const { email } = yield* createTestUser();
			const { error } = yield* Effect.promise(() =>
				createTestAuthClient().signUp.email({
					email,
					name: "Test User",
					password: "password123",
				}),
			);
			expect(error).toBeDefined();
		}),
	);
});
