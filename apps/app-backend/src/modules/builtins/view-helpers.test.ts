import { createEntityColumnExpression } from "@ryot/contract/display-configuration";
import { buildDefaultSavedViewQueryDocument } from "@ryot/query-engine";
import { Effect } from "effect";
import { assert, describe, expect, it } from "vitest";

import { validateDisplayConfiguration } from "#modules/saved-views/display-configuration-validation";

import { builtinEntitySchemas } from "./entity-schemas";
import { builtinSavedViews } from "./saved-views";
import { buildDefaultDisplayConfig, buildDisplayConfig } from "./view-helpers";

describe("buildDisplayConfig", () => {
	it("always sets entityIdProperty to the id column for the slug", () => {
		const config = buildDisplayConfig("movie");
		expect(config.entityIdProperty).toEqual(createEntityColumnExpression("movie", "id"));
	});

	it("validates every built-in saved-view display configuration", () => {
		const schemaBySlug = new Map(builtinEntitySchemas().map((schema) => [schema.slug, schema]));

		return Effect.runPromise(
			Effect.forEach(
				builtinSavedViews(),
				(view) => {
					if (!view.entitySchemaSlug) {
						return Effect.void;
					}

					const viewSchema = schemaBySlug.get(view.entitySchemaSlug);
					assert(viewSchema, `Missing built-in entity schema for ${view.entitySchemaSlug}`);
					const doc =
						view.queryDocument ??
						buildDefaultSavedViewQueryDocument({
							schemas: [view.entitySchemaSlug],
							requireInLibrary: view.requireInLibrary,
						});

					return validateDisplayConfiguration({
						doc,
						displayConfig: view.displayConfiguration,
						loadSchemas: (slugs) =>
							Effect.sync(() =>
								slugs.map((slug) => {
									const schema = schemaBySlug.get(slug);
									assert(schema, `Missing built-in entity schema for ${slug}`);
									return { slug, propertiesSchema: schema.propertiesSchema };
								}),
							),
					});
				},
				{ discard: true },
			),
		);
	});

	it("grid and list have the same title and image properties", () => {
		const config = buildDisplayConfig("movie");
		expect(config.grid.titleProperty).toEqual(config.list.titleProperty);
		expect(config.grid.imageProperty).toEqual(config.list.imageProperty);
	});

	describe("calloutProperty", () => {
		it("is non-null for the default media slug (uses avg rating)", () => {
			const config = buildDisplayConfig("movie");
			expect(config.grid.calloutProperty).not.toBeNull();
		});

		it("is non-null for exercise slug (uses level)", () => {
			const config = buildDisplayConfig("exercise");
			expect(config.grid.calloutProperty).not.toBeNull();
		});

		it("is null for workout slug", () => {
			const config = buildDisplayConfig("workout");
			expect(config.grid.calloutProperty).toBeNull();
		});

		it("is null for workout-template slug", () => {
			const config = buildDisplayConfig("workout-template");
			expect(config.grid.calloutProperty).toBeNull();
		});

		it("is null for measurement slug", () => {
			const config = buildDisplayConfig("measurement");
			expect(config.grid.calloutProperty).toBeNull();
		});

		it("is null for person slug", () => {
			const config = buildDisplayConfig("person");
			expect(config.grid.calloutProperty).toBeNull();
		});

		it("is null for collection slug", () => {
			const config = buildDisplayConfig("collection");
			expect(config.grid.calloutProperty).toBeNull();
		});
	});

	describe("secondarySubtitleProperty", () => {
		it("is non-null for book slug (production status)", () => {
			const config = buildDisplayConfig("book");
			expect(config.grid.secondarySubtitleProperty).not.toBeNull();
		});

		it("is non-null for movie slug (runtime conditional)", () => {
			const config = buildDisplayConfig("movie");
			expect(config.grid.secondarySubtitleProperty).not.toBeNull();
		});

		it("is non-null for anime slug (episodes conditional)", () => {
			const config = buildDisplayConfig("anime");
			expect(config.grid.secondarySubtitleProperty).not.toBeNull();
		});

		it("is null for an unrecognized slug", () => {
			const config = buildDisplayConfig("custom-schema");
			expect(config.grid.secondarySubtitleProperty).toBeNull();
		});
	});

	describe("table columns", () => {
		it("returns one column for collection slug", () => {
			const { table } = buildDisplayConfig("collection");
			expect(table.columns).toHaveLength(1);
			expect(table.columns[0]?.label).toBe("Name");
		});

		it("returns two columns (name + birth place) for person slug", () => {
			const { table } = buildDisplayConfig("person");
			expect(table.columns).toHaveLength(2);
			expect(table.columns.map((c) => c.label)).toEqual(["Name", "Birth Place"]);
		});

		it("returns three columns for exercise slug", () => {
			const { table } = buildDisplayConfig("exercise");
			expect(table.columns).toHaveLength(3);
			expect(table.columns.map((c) => c.label)).toEqual(["Name", "Level", "Equipment"]);
		});

		it("returns three columns for workout slug", () => {
			const { table } = buildDisplayConfig("workout");
			expect(table.columns).toHaveLength(3);
			expect(table.columns.map((c) => c.label)).toEqual(["Name", "Started At", "Ended At"]);
		});

		it("returns three columns (name, year, runtime) for movie slug", () => {
			const { table } = buildDisplayConfig("movie");
			expect(table.columns).toHaveLength(3);
			expect(table.columns.map((c) => c.label)).toEqual(["Name", "Year", "Runtime"]);
		});

		it("returns three columns (name, year, status) for show slug", () => {
			const { table } = buildDisplayConfig("show");
			expect(table.columns).toHaveLength(3);
			expect(table.columns.map((c) => c.label)).toEqual(["Name", "Year", "Status"]);
		});

		it("returns three columns (name, year, pages) for book slug", () => {
			const { table } = buildDisplayConfig("book");
			expect(table.columns).toHaveLength(3);
			expect(table.columns.map((c) => c.label)).toEqual(["Name", "Year", "Pages"]);
		});

		it("returns two columns (name, year) for an unrecognized slug", () => {
			const { table } = buildDisplayConfig("custom-schema");
			expect(table.columns).toHaveLength(2);
			expect(table.columns.map((c) => c.label)).toEqual(["Name", "Year"]);
		});

		it("returns three columns (name, year, episodes) for anime slug", () => {
			const { table } = buildDisplayConfig("anime");
			expect(table.columns).toHaveLength(3);
			expect(table.columns.map((c) => c.label)).toEqual(["Name", "Year", "Episodes"]);
		});
	});
});

describe("buildDefaultDisplayConfig", () => {
	it("uses only built-in entity columns for custom schemas", () => {
		const config = buildDefaultDisplayConfig("custom-schema");

		expect(config.entityIdProperty).toEqual(createEntityColumnExpression("custom-schema", "id"));
		expect(config.table.columns).toEqual([
			{ label: "Name", expression: createEntityColumnExpression("custom-schema", "name") },
		]);
		expect(config.grid.imageProperty).toBeNull();
		expect(config.grid.primarySubtitleProperty).toBeNull();
	});
});
