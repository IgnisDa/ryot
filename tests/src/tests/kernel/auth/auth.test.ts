import { queryEngineField, queryEngineSystemRef } from "@ryot/query-engine/primitives";
import { Effect } from "effect";

import {
	buildEntityRowsQueryDocument,
	createTestAuthClient,
	createTestUser,
	executeQueryEngine,
	getBackendClient,
	makeSession,
	requireQueryEngineObjectField,
	requireQueryEngineTextField,
	signInWithPassword,
} from "~/fixtures";
import { assert, describe, expect, it } from "~/support/effect-test";

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
		"bootstraps a new user with plugin workspace state and default notification rules after sign-up",
		() =>
			Effect.gen(function* () {
				const { cookies, email, password } = yield* createTestUser();
				const headers = { Cookie: cookies };
				const workspaces = yield* getBackendClient().call(
					(c) => c.definitions.listWorkspaces({ query: { includeDisabled: true } }),
					headers,
				);
				expect(workspaces.length).toBeGreaterThan(0);

				const [catalog, rules] = yield* Effect.all([
					getBackendClient().call((c) => c.automations.listCatalog(), headers),
					getBackendClient().call((c) => c.automations.listRules(), headers),
				]);
				expect(rules).toHaveLength(catalog.length);
				expect(rules.map((rule) => rule.signalSchema.id).sort()).toEqual(
					catalog.map((schema) => schema.id).sort(),
				);
				expect(rules.every((rule) => rule.isActive)).toBe(true);

				const retrySignIn = yield* signInWithPassword(email, password);
				const retryCookies = retrySignIn.cookies;
				expect(retryCookies).toBeDefined();
				const libraryRows = yield* executeQueryEngine(
					makeSession(undefined, { Cookie: retryCookies ?? cookies }),
					buildEntityRowsQueryDocument({
						alias: "library",
						schemas: ["library"],
						fields: [
							queryEngineField("id", queryEngineSystemRef("library", "id")),
							queryEngineField("name", queryEngineSystemRef("library", "name")),
							queryEngineField("properties", queryEngineSystemRef("library", "properties")),
						],
					}),
				);
				expect(libraryRows.data.items).toHaveLength(1);
				const library = libraryRows.data.items[0];
				assert(library);
				expect(requireQueryEngineTextField(library, "name")).toBe("Library");
				expect(requireQueryEngineObjectField(library, "properties")).toEqual({});
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
