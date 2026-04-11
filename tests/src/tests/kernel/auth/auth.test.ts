import { column, document, eq, field, literal, rows, table } from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createTestAuthClient,
	createTestUser,
	executeRyotQL,
	getBackendClient,
	makeSession,
	requireRyotQLFieldValue,
	requireRyotQLTextField,
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
		"bootstraps a new user with plugin state and default notification rules after sign-up",
		() =>
			Effect.gen(function* () {
				const { cookies, email, password } = yield* createTestUser();
				const headers = { Cookie: cookies };
				const plugins = yield* getBackendClient().call(
					(c) => c.definitions.listPlugins({ query: { includeDisabled: true } }),
					headers,
				);
				expect(plugins.length).toBeGreaterThan(0);

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
				const library = table("entity", "library");
				const libraryResponse = yield* executeRyotQL(
					makeSession(undefined, { Cookie: retryCookies ?? cookies }),
					document({
						libraries: rows(library, {
							fields: [
								field("id", column(library, "id")),
								field("name", column(library, "name")),
								field("properties", column(library, "properties")),
							],
							where: eq(column(library, "entitySchemaSlug"), literal("library")),
						}),
					}),
				);
				const libraries = libraryResponse.data.libraries;
				assert(libraries?.type === "rows");
				expect(libraries.items).toHaveLength(1);
				const libraryRow = libraries.items[0];
				assert(libraryRow);
				expect(requireRyotQLTextField(libraryRow, "name")).toBe("Library");
				expect(requireRyotQLFieldValue(libraryRow, "properties")).toEqual({
					kind: "json",
					value: {},
				});
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
