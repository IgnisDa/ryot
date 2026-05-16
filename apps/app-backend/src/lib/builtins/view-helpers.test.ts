import { describe, expect, it } from "vitest";

import { createEntityColumnExpression } from "#lib/query-language";

import {
	buildDefaultQueryDefinition,
	buildDisplayConfig,
	inLibraryRelationshipJoin,
} from "./view-helpers";

describe("buildDisplayConfig", () => {
	it("always sets entityIdProperty to the id column for the slug", () => {
		const config = buildDisplayConfig("movie");
		expect(config.entityIdProperty).toEqual(createEntityColumnExpression("movie", "id"));
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

describe("buildDefaultQueryDefinition", () => {
	it("returns entities mode with null filter and empty joins", () => {
		const def = buildDefaultQueryDefinition(["movie"]);
		expect(def.mode).toBe("entities");
		expect(def.filter).toBeNull();
		expect(def.eventJoins).toEqual([]);
		expect(def.relationshipJoins).toEqual([]);
		expect(def.computedFields).toEqual([]);
	});

	it("sets the scope to the provided slugs", () => {
		const def = buildDefaultQueryDefinition(["book", "audiobook"]);
		expect(def.scope).toEqual(["book", "audiobook"]);
	});

	it("defaults sort direction to ascending by name", () => {
		const def = buildDefaultQueryDefinition(["movie"]);
		expect(def.sort.direction).toBe("asc");
	});

	it("includes provided relationship joins", () => {
		const def = buildDefaultQueryDefinition(["movie"], {
			relationshipJoins: [inLibraryRelationshipJoin],
		});
		expect(def.relationshipJoins).toEqual([inLibraryRelationshipJoin]);
	});
});

describe("inLibraryRelationshipJoin", () => {
	it("uses the in-library relationship schema slug", () => {
		expect(inLibraryRelationshipJoin.relationshipSchemaSlug).toBe("in-library");
	});

	it("is required and outgoing", () => {
		expect(inLibraryRelationshipJoin.required).toBe(true);
		expect(inLibraryRelationshipJoin.direction).toBe("outgoing");
	});
});
