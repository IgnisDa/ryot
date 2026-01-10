import { Effect } from "effect";

import {
	createAuthenticatedClient,
	findBuiltinTracker,
	listEntitySchemas,
	listEventSchemas,
	listSavedViews,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const GROUP_SCHEMA_SLUGS = [
	"book-group",
	"movie-group",
	"music-group",
	"audiobook-group",
	"comic-book-group",
	"video-game-group",
] as const;

describe("media group entity schemas", () => {
	it.live("all six group schemas are present in the builtin media tracker", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinTracker = yield* findBuiltinTracker(client);
			const schemas = yield* listEntitySchemas(client, { trackerId: builtinTracker.id });

			for (const slug of GROUP_SCHEMA_SLUGS) {
				expect(schemas.some((s) => s.slug === slug)).toBe(true);
			}
		}),
	);

	it.live("each group schema is marked as builtin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinTracker = yield* findBuiltinTracker(client);
			const schemas = yield* listEntitySchemas(client, { trackerId: builtinTracker.id });

			for (const slug of GROUP_SCHEMA_SLUGS) {
				const schema = schemas.find((s) => s.slug === slug);
				expect(schema).toBeDefined();
				expect(schema?.isBuiltin).toBe(true);
			}
		}),
	);

	it.live("group schemas expose only the review event schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinTracker = yield* findBuiltinTracker(client);
			const schemas = yield* listEntitySchemas(client, { trackerId: builtinTracker.id });
			const eventSchemasBySlug = yield* Effect.all(
				GROUP_SCHEMA_SLUGS.map((slug) =>
					Effect.gen(function* () {
						const schema = schemas.find((s) => s.slug === slug);
						assertPresent(schema, `Group schema '${slug}' not found`);
						return { eventSchemas: yield* listEventSchemas(client, schema.id), slug };
					}),
				),
			);

			for (const { eventSchemas } of eventSchemasBySlug) {
				const eventSlugs = eventSchemas.map((e) => e.slug);

				expect(eventSlugs).toContain("review");
				expect(eventSlugs).not.toContain("backlog");
				expect(eventSlugs).not.toContain("progress");
				expect(eventSlugs).not.toContain("complete");
			}
		}),
	);

	it.live("group schemas have the shared properties schema fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinTracker = yield* findBuiltinTracker(client);
			const schemas = yield* listEntitySchemas(client, { trackerId: builtinTracker.id });

			const movieGroup = schemas.find((s) => s.slug === "movie-group");
			assertPresent(movieGroup, "movie-group schema not found");

			const fields = movieGroup.propertiesSchema.fields;
			expect(Object.keys(fields)).toEqual(
				expect.arrayContaining(["images", "parts", "description", "sourceUrl"]),
			);
		}),
	);

	it.live("group schemas have provider scripts seeded", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinTracker = yield* findBuiltinTracker(client);
			const schemas = yield* listEntitySchemas(client, { trackerId: builtinTracker.id });

			const movieGroup = schemas.find((s) => s.slug === "movie-group");
			assertPresent(movieGroup, "movie-group schema not found");
			expect(movieGroup.providers.length).toBeGreaterThanOrEqual(2);

			const musicGroup = schemas.find((s) => s.slug === "music-group");
			assertPresent(musicGroup, "music-group schema not found");
			expect(musicGroup.providers.length).toBeGreaterThanOrEqual(3);
		}),
	);
});

describe("media group saved views", () => {
	it.live("builtin saved views include one view per group schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const views = yield* listSavedViews(client);

			const expectedViewSlugs = [
				"all-book-series",
				"all-music-albums",
				"all-movie-series",
				"all-audiobook-series",
				"all-comic-book-series",
				"all-video-game-franchises",
			];

			for (const slug of expectedViewSlugs) {
				expect(views.some((v) => v.slug === slug && v.isBuiltin)).toBe(true);
			}
		}),
	);

	it.live("group saved views are scoped to the correct entity schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const views = yield* listSavedViews(client);

			const movieGroupView = views.find((v) => v.slug === "all-movie-series");
			expect(movieGroupView?.isBuiltin).toBe(true);
			expect(movieGroupView?.name).toBe("All Movie Series");
		}),
	);
});
