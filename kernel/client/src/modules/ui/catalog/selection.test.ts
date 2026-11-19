import { describe, expect, it } from "bun:test";

import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { testCatalog } from "@ryot-app/plugin-client-sdk/testing";

import { testTranslate } from "#/modules/i18n/provider.test-support";

import {
	availableCatalogEntries,
	type CatalogEntry,
	findBySlug,
	groupCatalogEntries,
	pluginCatalogGroup,
} from "./selection";

const source = (input: {
	name: string;
	slug: string;
	description?: string;
	isAvailable?: boolean;
	packageId: PluginPackageId;
}) => ({
	name: input.name,
	slug: input.slug,
	packageId: input.packageId,
	isAvailable: input.isAvailable ?? true,
	description: input.description ?? `${input.name} description`,
});

const t = testTranslate([
	testCatalog("owner-a", { "plugin.name": "Whiskey" }),
	testCatalog("owner-b", { "plugin.name": "Whiskey" }),
]);

it("distinguishes equal plugin names with exact owner keys and scoped package labels", () => {
	const first = pluginCatalogGroup(
		{
			pluginScope: "system",
			packageId: PluginPackageId.make("acme/whiskey"),
			pluginName: { key: "plugin.name", namespace: "owner-a" },
			reference: { slug: "common", owner: { kind: "plugin", pluginId: PluginId.make("owner-a") } },
		},
		t,
	);
	const second = pluginCatalogGroup(
		{
			pluginScope: "user",
			packageId: PluginPackageId.make("home/whiskey"),
			pluginName: { key: "plugin.name", namespace: "owner-b" },
			reference: { slug: "common", owner: { kind: "plugin", pluginId: PluginId.make("owner-b") } },
		},
		t,
	);
	expect(first.key).not.toBe(second.key);
	expect<string>(first.heading).toBe("Whiskey · System · acme/whiskey");
	expect<string>(second.heading).toBe("Whiskey · Private · home/whiskey");
});

const toEntry = (item: ReturnType<typeof source>): CatalogEntry => ({
	badge: "Badge",
	key: item.slug,
	name: item.name,
	description: item.description,
	isAvailable: item.isAvailable,
	group: { key: item.packageId, heading: item.packageId },
	requirement: item.isAvailable ? undefined : "Not ready.",
});

const fixture = PluginPackageId.make("ryot/fixture");
const otherTracker = PluginPackageId.make("test/other-tracker");

const sources = [
	source({ packageId: fixture, name: "Beta Service", slug: "beta-service" }),
	source({ packageId: fixture, isAvailable: false, name: "Alpha Service", slug: "alpha-service" }),
	source({ name: "Gamma Service", slug: "gamma-service", packageId: otherTracker }),
];

describe("catalog selection", () => {
	it("groups by the group each entry names and sorts entries by name", () => {
		const groups = groupCatalogEntries(sources, "", toEntry);

		expect(groups.map((group) => group.heading)).toEqual(["ryot/fixture", "test/other-tracker"]);
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
