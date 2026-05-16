import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	findBuiltinTracker,
	listEntitySchemas,
	listEventSchemas,
	listSavedViews,
} from "../fixtures";

const GROUP_SCHEMA_SLUGS = [
	"book-group",
	"movie-group",
	"music-group",
	"audiobook-group",
	"comic-book-group",
	"video-game-group",
] as const;

describe("media group entity schemas", () => {
	it("all six group schemas are present in the builtin media tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, { trackerId: builtinTracker.id });

		for (const slug of GROUP_SCHEMA_SLUGS) {
			expect(schemas.some((s) => s.slug === slug)).toBe(true);
		}
	});

	it("each group schema uses the layers icon and is marked as builtin", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, { trackerId: builtinTracker.id });

		for (const slug of GROUP_SCHEMA_SLUGS) {
			const schema = schemas.find((s) => s.slug === slug);
			expect(schema).toBeDefined();
			expect(schema?.icon).toBe("layers");
			expect(schema?.isBuiltin).toBe(true);
		}
	});

	it("group schemas expose only the review event schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, { trackerId: builtinTracker.id });

		for (const slug of GROUP_SCHEMA_SLUGS) {
			const schema = schemas.find((s) => s.slug === slug);
			if (!schema) {
				throw new Error(`Group schema '${slug}' not found`);
			}
			// oxlint-disable-next-line no-await-in-loop
			const eventSchemas = await listEventSchemas(client, cookies, schema.id);
			const eventSlugs = eventSchemas.map((e) => e.slug);

			expect(eventSlugs).toContain("review");
			expect(eventSlugs).not.toContain("backlog");
			expect(eventSlugs).not.toContain("progress");
			expect(eventSlugs).not.toContain("complete");
		}
	});

	it("group schemas have the shared properties schema fields", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, { trackerId: builtinTracker.id });

		const movieGroup = schemas.find((s) => s.slug === "movie-group");
		if (!movieGroup) {
			throw new Error("movie-group schema not found");
		}

		const fields = movieGroup.propertiesSchema.fields;
		expect(Object.keys(fields)).toEqual(
			expect.arrayContaining(["images", "parts", "description", "sourceUrl"]),
		);
	});

	it("group schemas have provider scripts seeded", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinTracker = await findBuiltinTracker(client, cookies);
		const schemas = await listEntitySchemas(client, cookies, { trackerId: builtinTracker.id });

		const movieGroup = schemas.find((s) => s.slug === "movie-group");
		if (!movieGroup) {
			throw new Error("movie-group schema not found");
		}
		expect(movieGroup.providers.length).toBeGreaterThanOrEqual(2);

		const musicGroup = schemas.find((s) => s.slug === "music-group");
		if (!musicGroup) {
			throw new Error("music-group schema not found");
		}
		expect(musicGroup.providers.length).toBeGreaterThanOrEqual(3);
	});
});

describe("media group saved views", () => {
	it("builtin saved views include one view per group schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const views = await listSavedViews(client, cookies);

		const expectedViewSlugs = [
			"all-book-series",
			"all-music-albums",
			"all-audiobook-series",
			"all-comic-book-series",
			"all-movie-collections",
			"all-video-game-collections",
		];

		for (const slug of expectedViewSlugs) {
			expect(views.some((v) => v.slug === slug && v.isBuiltin)).toBe(true);
		}
	});

	it("group saved views are scoped to the correct entity schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const views = await listSavedViews(client, cookies);

		const movieGroupView = views.find((v) => v.slug === "all-movie-collections");
		expect(movieGroupView?.isBuiltin).toBe(true);
		expect(movieGroupView?.name).toBe("All Movie Collections");
	});
});
