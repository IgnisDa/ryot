import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { activeSignalSchemasRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { Effect } from "effect";

import {
	createTestAuthClient,
	createTestUser,
	collectRyotQLRecipeItems,
	executeRyotQL,
	getApiClient,
	makeSession,
	requireRyotQLText,
	requireRyotQLValue,
	requireRows,
	listNotificationSubscriptions,
	signInWithPassword,
} from "~/fixtures/kernel";
import { assert, describe, expect, it } from "~/support/effect-test";

describe("GET /system/config auth block defaults", () => {
	it.live("returns correct auth defaults", () =>
		Effect.gen(function* () {
			const client = getApiClient();
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
				const { token, email, password } = yield* createTestUser();
				const client = makeSession(undefined, { Authorization: `Bearer ${token}` });
				const plugins = yield* collectRyotQLRecipeItems(client, (after) =>
					pluginInstallationsRecipe({ after, limit: 100 }),
				);
				expect(plugins.length).toBeGreaterThan(0);

				const [catalog, rules] = yield* Effect.all([
					collectRyotQLRecipeItems(client, (after) =>
						activeSignalSchemasRecipe({ after, limit: 100 }),
					),
					listNotificationSubscriptions(client, { limit: 100 }),
				]);
				expect(rules).toHaveLength(catalog.length);
				expect(rules.map((rule) => rule.signalSchemaSlug).sort()).toEqual(
					catalog.map((schema) => schema.slug).sort(),
				);
				expect(rules.every((rule) => rule.isActive)).toBe(true);

				const retrySignIn = yield* signInWithPassword(email, password);
				const retryToken = retrySignIn.token;
				expect(retryToken).toBeDefined();
				const mediaLibrary = table("entity", "mediaLibrary");
				const libraryResponse = yield* executeRyotQL(
					makeSession(undefined, { Authorization: `Bearer ${retryToken ?? token}` }),
					document({
						libraries: rows(mediaLibrary, {
							where: eq(column(mediaLibrary, "entitySchemaSlug"), literal("media-library")),
							fields: [
								field("id", column(mediaLibrary, "id")),
								field("name", column(mediaLibrary, "name")),
								field("properties", column(mediaLibrary, "properties")),
							],
						}),
					}),
				);
				const libraries = requireRows(libraryResponse.data.libraries, "libraries");
				expect(libraries.items).toHaveLength(1);
				const libraryRow = libraries.items[0];
				assert(libraryRow);
				expect(requireRyotQLText(libraryRow, "name")).toBe("Media Library");
				expect(requireRyotQLValue(libraryRow, "properties")).toEqual({});
			}),
	);

	it.live("returns an error for a duplicate email sign-up", () =>
		Effect.gen(function* () {
			const { email } = yield* createTestUser();
			const { error } = yield* Effect.promise(() =>
				createTestAuthClient().signUp.email({ email, name: "Test User", password: "password123" }),
			);
			expect(error).toBeDefined();
		}),
	);
});
