import { describe, expect, it } from "vitest";

import {
	availableCatalogEntries,
	type CatalogEntry,
	findBySlug,
	groupCatalogEntries,
	pluginHeading,
} from "./selection";

const source = (input: {
	name: string;
	slug: string;
	pluginSlug: string;
	description?: string;
	isAvailable?: boolean;
}) => ({
	name: input.name,
	slug: input.slug,
	pluginSlug: input.pluginSlug,
	isAvailable: input.isAvailable ?? true,
	description: input.description ?? `${input.name} description`,
});

const toEntry = (item: ReturnType<typeof source>): CatalogEntry => ({
	badge: "Badge",
	slug: item.slug,
	name: item.name,
	description: item.description,
	isAvailable: item.isAvailable,
	requirement: item.isAvailable ? undefined : "Not ready.",
});

const sources = [
	source({ name: "Netflix", slug: "netflix", pluginSlug: "media" }),
	source({ name: "Audible", slug: "audible", pluginSlug: "media", isAvailable: false }),
	source({ name: "Strava", slug: "strava", pluginSlug: "fitness-tracker" }),
];

describe("catalog selection", () => {
	it("titles plugin headings from their slug", () => {
		expect(pluginHeading("media")).toBe("Media");
		expect(pluginHeading("my-other_plugin")).toBe("My Other Plugin");
		expect(pluginHeading("")).toBe("Other");
	});

	it("groups by plugin and sorts entries by name", () => {
		const groups = groupCatalogEntries(sources, "", toEntry);

		expect(groups.map((group) => group.heading)).toEqual(["Media", "Fitness Tracker"]);
		expect(groups[0]?.entries.map((entry) => entry.name)).toEqual(["Audible", "Netflix"]);
	});

	it("matches the query against names and descriptions", () => {
		expect(groupCatalogEntries(sources, "netflix", toEntry)[0]?.entries).toHaveLength(1);
		expect(
			groupCatalogEntries(sources, "strava description", toEntry)[0]?.entries.map(
				({ slug }) => slug,
			),
		).toEqual(["strava"]);
		expect(groupCatalogEntries(sources, "nothing here", toEntry)).toEqual([]);
	});

	it("ignores surrounding whitespace and case in the query", () => {
		expect(groupCatalogEntries(sources, "  NETFLIX  ", toEntry)[0]?.entries).toHaveLength(1);
	});

	it("collects only the entries that can be chosen", () => {
		expect(
			availableCatalogEntries(groupCatalogEntries(sources, "", toEntry)).map(({ slug }) => slug),
		).toEqual(["netflix", "strava"]);
	});

	it("finds an item by slug", () => {
		expect(findBySlug(sources, "strava")?.name).toBe("Strava");
		expect(findBySlug(sources, undefined)).toBeUndefined();
		expect(findBySlug(sources, "missing")).toBeUndefined();
	});
});
