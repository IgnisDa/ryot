import { createEntityColumnExpression } from "@ryot/contract/display-configuration";
import { describe, expect, it } from "vitest";

import { buildDefaultDisplayConfig, buildDisplayConfig } from "./view-helpers";

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

	it("uses the expected media callouts", () => {
		expect(buildDisplayConfig("movie").grid.calloutProperty).not.toBeNull();
		expect(buildDisplayConfig("person").grid.calloutProperty).toBeNull();
	});

	it("uses schema-specific secondary subtitles", () => {
		expect(buildDisplayConfig("book").grid.secondarySubtitleProperty).not.toBeNull();
		expect(buildDisplayConfig("movie").grid.secondarySubtitleProperty).not.toBeNull();
		expect(buildDisplayConfig("anime").grid.secondarySubtitleProperty).not.toBeNull();
		expect(buildDisplayConfig("custom-schema").grid.secondarySubtitleProperty).toBeNull();
	});

	it.each([
		["person", ["Name", "Birth Place"]],
		["movie", ["Name", "Year", "Runtime"]],
		["show", ["Name", "Year", "Status"]],
		["book", ["Name", "Year", "Pages"]],
		["custom-schema", ["Name", "Year"]],
		["anime", ["Name", "Year", "Episodes"]],
	] as const)("builds the expected %s table columns", (slug, labels) => {
		expect(buildDisplayConfig(slug).table.columns.map(({ label }) => label)).toEqual(labels);
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
