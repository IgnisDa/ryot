import { PluginPackageId, SavedViewId } from "@ryot-app/contract/schema/brands";
import type { NavigationData, NavigationView } from "@ryot-app/ryotql-recipes/navigation";
import { describe, expect, it } from "vitest";

import {
	sidebarItemKey,
	sidebarSections,
	workspaceSummary,
} from "#/modules/shell/sidebar-sections";

const fixture = PluginPackageId.make("ryot/fixture");
const other = PluginPackageId.make("ryot/other");

const view = (overrides: Partial<NavigationView> = {}): NavigationView => ({
	name: "View",
	slug: "view",
	icon: "list",
	sortOrder: 0,
	isHidden: false,
	packageId: null,
	...overrides,
	reference: overrides.reference ?? {
		kind: "custom",
		savedViewId: SavedViewId.make(overrides.slug ?? "view"),
	},
	pluginInstallationId:
		overrides.pluginInstallationId ??
		(overrides.packageId ? `installation-${overrides.packageId}` : null),
});

type NavigationCollection = NavigationData["collections"][number];

const collection = (overrides: Partial<NavigationCollection> = {}): NavigationCollection => ({
	sortOrder: 0,
	reference: null,
	isHidden: false,
	packageId: null,
	icon: "layers-3",
	name: "Collection",
	slug: "collection",
	pluginInstallationId: null,
	...overrides,
});

describe("sidebar sections", () => {
	it("filters hidden rows, sorts items, and scopes workspace and global views", () => {
		const data: NavigationData = {
			collections: [
				collection({ sortOrder: 2, slug: "second", name: "Second Collection" }),
				collection({ sortOrder: 1, name: "First Collection", slug: "first-collection" }),
				collection({ isHidden: true, name: "Hidden Collection", slug: "hidden-collection" }),
			],
			savedViews: [
				view({ sortOrder: 4, name: "Later", slug: "later", packageId: fixture }),
				view({ sortOrder: 2, name: "Global", slug: "global" }),
				view({ name: "First", slug: "first", sortOrder: -1, packageId: fixture }),
				view({ name: "Other", slug: "other", packageId: other }),
				view({ name: "Hidden", slug: "hidden", isHidden: true, packageId: fixture }),
			],
		};

		const sections = sidebarSections({
			data,
			workspaceInstallationId: "installation-ryot/fixture",
		});

		expect(sections.views.map((item) => [item.name, item.kind])).toEqual([
			["Home", "home"],
			["First", "view"],
			["Later", "view"],
		]);
		expect(sections.savedViews.map((item) => item.name)).toEqual(["Global"]);
		expect(sections.collections.map((item) => item.name)).toEqual([
			"First Collection",
			"Second Collection",
		]);
		expect(workspaceSummary(sections)).toBe("3 views");
	});

	it("pluralizes a Home-only workspace summary", () => {
		const sections = sidebarSections({
			workspaceInstallationId: undefined,
			data: { savedViews: [], collections: [] },
		});

		expect(sections.views.map(sidebarItemKey)).toEqual(["home"]);
		expect(workspaceSummary(sections)).toBe("1 view");
	});
});
