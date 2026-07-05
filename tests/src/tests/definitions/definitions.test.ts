import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("Definitions E2E", () => {
	it.live("lists installed entity definitions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* client.call((c) => c.definitions.listEntities({}));

			expect(Array.isArray(schemas)).toBe(true);
			expect(schemas.length).toBeGreaterThan(0);
			const firstSchema = schemas[0];
			expect(firstSchema?.name).toBeDefined();
			expect(firstSchema?.slug).toBeDefined();
			expect(firstSchema?.icon).toBeDefined();
			expect(firstSchema?.accentColor).toBeDefined();
			expect(firstSchema?.propertiesSchema).toBeDefined();
		}),
	);

	it.live("includes the built-in collection definition", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* client.call((c) => c.definitions.listEntities({}));
			const collectionSchema = schemas.find((schema) => schema.slug === "collection");

			expect(collectionSchema).toBeDefined();
			expect(collectionSchema).toMatchObject({
				icon: "folders",
				name: "Collection",
				accentColor: "#F59E0B",
				propertiesSchema: {
					fields: {
						description: { type: "string", label: "Description" },
						membershipPropertiesSchema: {
							type: "object",
							properties: {},
							unknownKeys: "passthrough",
							label: "Membership Properties Schema",
						},
					},
				},
			});
		}),
	);

	it.live("lists installed relationship definitions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* client.call((c) => c.definitions.listRelationships({}));
			const selected = schemas.filter((schema) =>
				["in-library", "member-of"].includes(schema.slug),
			);

			expect(selected.map((schema) => schema.slug)).toEqual(["in-library", "member-of"]);
			expect(selected[0]?.targetEntitySchemaSlug).not.toBeNull();
		}),
	);

	it.live("lists installed tracker definitions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const trackers = yield* client.call((c) => c.definitions.listTrackers({}));
			const selected = trackers.filter((tracker) => ["media", "fitness"].includes(tracker.slug));

			expect(selected.map((tracker) => tracker.slug)).toEqual(["media", "fitness"]);
			expect(selected.every((tracker) => tracker.entitySchemaSlugs.length > 0)).toBe(true);
		}),
	);
});
