import { describe, expect, it } from "vitest";

import { buildViewExpressions } from "./view-helpers";

describe("buildViewExpressions", () => {
	it("uses the entity alias and a schema-name literal", () => {
		const config = buildViewExpressions("movie", "Movie");

		expect(config.grid.title).toEqual({
			field: "name",
			type: "column",
			tableAlias: "entity",
		});
		expect(config.grid.eyebrow).toEqual({ type: "literal", value: "Movie" });
		expect(config.grid.image).toEqual({
			type: "jsonPath",
			path: ["images", 0],
			expr: { type: "column", field: "properties", tableAlias: "entity" },
		});
	});

	it("uses conditional unit subtitles", () => {
		const expression = buildViewExpressions("movie", "Movie").grid.secondarySubtitle;

		expect(expression).toMatchObject({
			type: "conditional",
			whenTrue: { type: "concat" },
			condition: { type: "isNotNull" },
			whenFalse: { type: "literal", value: null },
		});
	});

	it("uses review events for media callouts", () => {
		const expression = buildViewExpressions("movie", "Movie").grid.callout;

		expect(expression).toMatchObject({
			type: "aggregate",
			aggregation: {
				function: "average",
				expr: {
					type: "cast",
					target: "number",
					expr: {
						path: ["rating"],
						type: "jsonPath",
						expr: { field: "properties", tableAlias: "review" },
					},
				},
			},
			query: {
				from: { table: "event", alias: "review" },
				where: {
					type: "and",
					predicates: expect.arrayContaining([
						expect.objectContaining({ right: { type: "literal", value: "review" } }),
					]),
				},
			},
		});
	});

	it.each([
		["person", ["Name", "Birth Place"]],
		["movie", ["Name", "Year", "Runtime"]],
		["show", ["Name", "Year", "Status"]],
		["book", ["Name", "Year", "Pages"]],
		["custom-schema", ["Name", "Year"]],
		["anime", ["Name", "Year", "Episodes"]],
	] as const)("builds the expected %s table columns", (slug, labels) => {
		expect(buildViewExpressions(slug, "Schema").table.map(({ label }) => label)).toEqual(labels);
	});
});
