import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import {
	availableCatalogEntries,
	type CatalogEntry,
	findBySlug,
	groupCatalogEntries,
	pluginCatalogGroup,
	pluginHeading,
} from "./selection";

const source = (input: {
	name: string;
	slug: string;
	packageId: PluginPackageId;
	description?: string;
	isAvailable?: boolean;
}) => ({
	name: input.name,
	slug: input.slug,
	packageId: input.packageId,
	isAvailable: input.isAvailable ?? true,
	description: input.description ?? `${input.name} description`,
});

it("distinguishes equal plugin names with exact owner keys and scoped package labels", () => {
	const first = pluginCatalogGroup({
		name: "Whiskey",
		pluginScope: "system",
		packageId: PluginPackageId.make("acme/whiskey"),
		reference: { slug: "common", owner: { kind: "plugin", pluginId: PluginId.make("owner-a") } },
	});
	const second = pluginCatalogGroup({
		name: "Whiskey",
		pluginScope: "user",
		packageId: PluginPackageId.make("home/whiskey"),
		reference: { slug: "common", owner: { kind: "plugin", pluginId: PluginId.make("owner-b") } },
	});
	expect(first.key).not.toBe(second.key);
	expect(first.heading).toBe("Whiskey · System · acme/whiskey");
	expect(second.heading).toBe("Whiskey · Private · home/whiskey");
});

const toEntry = (item: ReturnType<typeof source>): CatalogEntry => ({
	badge: "Badge",
	key: item.slug,
	name: item.name,
	description: item.description,
	isAvailable: item.isAvailable,
	requirement: item.isAvailable ? undefined : "Not ready.",
	group: { key: item.packageId, heading: pluginHeading(item.packageId) },
});

const fixture = PluginPackageId.make("ryot/fixture");
const otherTracker = PluginPackageId.make("test/other-tracker");

const sources = [
	source({ packageId: fixture, name: "Beta Service", slug: "beta-service" }),
	source({ packageId: fixture, isAvailable: false, name: "Alpha Service", slug: "alpha-service" }),
	source({ name: "Gamma Service", slug: "gamma-service", packageId: otherTracker }),
];

describe("catalog selection", () => {
	it("titles plugin headings from the package name", () => {
		expect(pluginHeading(fixture)).toBe("Fixture");
		expect(pluginHeading(PluginPackageId.make("test/my-other-plugin"))).toBe("My Other Plugin");
	});

	it("groups by the group each entry names and sorts entries by name", () => {
		const groups = groupCatalogEntries(sources, "", toEntry);

		expect(groups.map((group) => group.heading)).toEqual(["Fixture", "Other Tracker"]);
		expect(groups.map((group) => group.key)).toEqual(["ryot/fixture", "test/other-tracker"]);
		expect(groups[0]?.entries.map((entry) => entry.name)).toEqual([
			"Alpha Service",
			"Beta Service",
		]);
	});

	it("keeps groups that share a key together under one heading", () => {
		const categorised = groupCatalogEntries(
			[
				source({ name: "Ntfy", slug: "ntfy", packageId: fixture }),
				source({ name: "Discord", slug: "discord", packageId: fixture }),
			],
			"",
			(item): CatalogEntry => ({
				badge: "Badge",
				key: item.slug,
				name: item.name,
				isAvailable: true,
				requirement: undefined,
				description: item.description,
				group:
					item.slug === "ntfy"
						? { key: "push", heading: "Push" }
						: { key: "chat", heading: "Chat" },
			}),
		);

		expect(categorised.map((group) => group.heading)).toEqual(["Push", "Chat"]);
	});

	it("matches the query against names and descriptions", () => {
		expect(groupCatalogEntries(sources, "beta service", toEntry)[0]?.entries).toHaveLength(1);
		expect(
			groupCatalogEntries(sources, "gamma service description", toEntry)[0]?.entries.map(
				({ key }) => key,
			),
		).toEqual(["gamma-service"]);
		expect(groupCatalogEntries(sources, "nothing here", toEntry)).toEqual([]);
	});

	it("ignores surrounding whitespace and case in the query", () => {
		expect(groupCatalogEntries(sources, "  BETA SERVICE  ", toEntry)[0]?.entries).toHaveLength(1);
	});

	it("collects only the entries that can be chosen", () => {
		expect(
			availableCatalogEntries(groupCatalogEntries(sources, "", toEntry)).map(({ key }) => key),
		).toEqual(["beta-service", "gamma-service"]);
	});

	it("finds an item by slug", () => {
		expect(findBySlug(sources, "gamma-service")?.name).toBe("Gamma Service");
		expect(findBySlug(sources, undefined)).toBeUndefined();
		expect(findBySlug(sources, "missing")).toBeUndefined();
	});
});
