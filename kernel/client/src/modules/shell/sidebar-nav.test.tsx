import { assert, describe, expect, it } from "@effect/vitest";
import { PluginId, PluginPackageId, SavedViewId } from "@ryot-app/contract/schema/brands";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalogEntry } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Effect } from "effect";
import { axe } from "vitest-axe";

import { SidebarNav } from "#/modules/shell/sidebar-nav";
import type { SidebarSections } from "#/modules/shell/sidebar-sections";

const current: PluginClientCatalogEntry = {
	icon: "film",
	sortOrder: 0,
	name: "Fixture",
	health: "ready",
	isHidden: false,
	scope: "system",
	clientApiVersion: 1,
	homeSavedView: null,
	clientEntities: null,
	contentHash: "source-fixture",
	installationId: "installation-fixture",
	pluginId: PluginId.make("plugin-fixture"),
	packageId: PluginPackageId.make("ryot/fixture"),
};

const navigation: NavigationData = {
	collections: [],
	savedViews: [
		{
			icon: "list",
			sortOrder: 1,
			isHidden: false,
			slug: "fixture-queue",
			name: "Fixture Queue",
			pluginInstallationId: "installation-fixture",
			packageId: PluginPackageId.make("ryot/fixture"),
			reference: {
				kind: "plugin",
				slug: "fixture-queue",
				pluginId: PluginId.make("plugin-fixture"),
			},
		},
	],
};

const sections: SidebarSections = {
	savedViews: [],
	collections: [],
	views: [
		{
			kind: "home",
			name: "Home",
			slug: "home",
			sortOrder: 0,
			icon: "house",
			isHidden: false,
			reference: null,
			packageId: null,
			pluginInstallationId: null,
		},
		{
			kind: "view",
			icon: "list",
			sortOrder: 1,
			isHidden: false,
			name: "Fixture Queue",
			slug: "fixture-queue",
			pluginInstallationId: "installation-fixture",
			packageId: PluginPackageId.make("ryot/fixture"),
			reference: {
				kind: "plugin",
				slug: "fixture-queue",
				pluginId: PluginId.make("plugin-fixture"),
			},
		},
	],
};

const renderSidebar = (
	showSearchShortcut: boolean,
	customize?: {
		readonly onCustomize?: () => void;
		readonly onEditSection?: (section: "views" | "savedViews") => void;
	},
	onCreateCollection: () => void = () => undefined,
) =>
	render(
		<SidebarNav
			current={current}
			activeHome={false}
			catalog={[current]}
			sections={sections}
			navigation={navigation}
			workspaceSwitcherOpen={false}
			onOpenSearch={() => undefined}
			onNavigateHome={() => undefined}
			onNavigateItem={() => undefined}
			onSelectWorkspace={() => undefined}
			onCustomize={customize?.onCustomize}
			onCreateCollection={onCreateCollection}
			showSearchShortcut={showSearchShortcut}
			onEditSection={customize?.onEditSection}
			onWorkspaceSwitcherOpenChange={() => undefined}
			activeKey="view:/v/p/ryot/fixture/fixture-queue"
		/>,
	);

describe("sidebar navigation", () => {
	it("renders sections, counts, empty messages, and the active row", () => {
		renderSidebar(true);

		expect(screen.getByRole("heading", { name: "Views" })).toBeTruthy();
		const savedViews = screen.getByRole("heading", { name: "Saved Views" }).parentElement;
		const collections = screen.getByRole("heading", { name: "Collections" }).parentElement;
		assert(savedViews);
		assert(collections);
		expect(within(savedViews).getByText("0")).toBeTruthy();
		expect(within(collections).getByText("0")).toBeTruthy();
		expect(screen.getByText("No saved views yet.")).toBeTruthy();
		expect(screen.getByText("No collections yet.")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Fixture Queue" }).getAttribute("aria-current")).toBe(
			"page",
		);
		expect(screen.getByText("K").tagName).toBe("KBD");
		expect(
			screen.getByRole("button", { name: "Open command center" }).getAttribute("aria-keyshortcuts"),
		).toBe("Mod+K");
	});

	it("starts a new collection from the collections section", () => {
		let creating = 0;
		renderSidebar(false, undefined, () => {
			creating += 1;
		});

		fireEvent.click(screen.getByRole("button", { name: "New collection" }));

		expect(creating).toBe(1);
	});

	it("opens search and hides the shortcut when requested", () => {
		let opened = false;
		render(
			<SidebarNav
				activeKey={null}
				current={current}
				activeHome={true}
				catalog={[current]}
				sections={sections}
				navigation={navigation}
				showSearchShortcut={false}
				workspaceSwitcherOpen={false}
				onNavigateHome={() => undefined}
				onNavigateItem={() => undefined}
				onSelectWorkspace={() => undefined}
				onCreateCollection={() => undefined}
				onWorkspaceSwitcherOpenChange={() => undefined}
				onOpenSearch={() => {
					opened = true;
				}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open command center" }));
		expect(opened).toBe(true);
		expect(screen.queryByText("K")).toBeNull();
		expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
	});

	it.live("has no accessibility violations", () =>
		Effect.gen(function* () {
			const view = renderSidebar(true);
			const results = yield* Effect.promise(() =>
				axe(view.container, { rules: { "color-contrast": { enabled: false } } }),
			);
			expect(results.violations.map((violation) => violation.id)).toEqual([]);
		}),
	);

	it("offers no customize affordances when the consumer supplies no handlers", () => {
		renderSidebar(true);

		expect(screen.queryByRole("button", { name: "Edit Views section" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Edit Saved Views section" })).toBeNull();
	});

	it("names the edited section on each header's Edit control", () => {
		const edited: string[] = [];
		renderSidebar(true, { onEditSection: (section) => edited.push(section) });

		fireEvent.click(screen.getByRole("button", { name: "Edit Views section" }));
		fireEvent.click(screen.getByRole("button", { name: "Edit Saved Views section" }));

		expect(edited).toEqual(["views", "savedViews"]);
	});

	it("offers no Edit control on the Collections section", () => {
		renderSidebar(true, { onEditSection: () => undefined });

		expect(screen.queryByRole("button", { name: "Edit Collections section" })).toBeNull();
	});
});

describe("sidebar overflow", () => {
	const manySections: SidebarSections = {
		collections: [],
		views: sections.views,
		savedViews: Array.from({ length: 9 }, (_, index) => ({
			icon: "list",
			isHidden: false,
			packageId: null,
			sortOrder: index,
			kind: "view" as const,
			name: `Saved ${index}`,
			slug: `saved-${index}`,
			pluginInstallationId: null,
			reference: { kind: "custom" as const, savedViewId: SavedViewId.make(`saved-${index}`) },
		})),
	};
	const renderMany = (props: {
		readonly activeKey: null | string;
		readonly expanded?: boolean | undefined;
		readonly onToggle?: (section: string, expanded: boolean) => void;
	}) =>
		render(
			<SidebarNav
				current={current}
				activeHome={false}
				catalog={[current]}
				sections={manySections}
				navigation={navigation}
				showSearchShortcut={false}
				activeKey={props.activeKey}
				workspaceSwitcherOpen={false}
				onOpenSearch={() => undefined}
				onNavigateHome={() => undefined}
				onNavigateItem={() => undefined}
				onToggleSection={props.onToggle}
				onSelectWorkspace={() => undefined}
				onCreateCollection={() => undefined}
				onWorkspaceSwitcherOpenChange={() => undefined}
				expandedSections={props.expanded === undefined ? {} : { savedViews: props.expanded }}
			/>,
		);

	it("shows seven views with a disclosure that reports its toggles", () => {
		const toggles: Array<readonly [string, boolean]> = [];
		renderMany({
			activeKey: null,
			onToggle: (section, expanded) => toggles.push([section, expanded]),
		});

		expect(screen.getAllByRole("link", { name: /^Saved / })).toHaveLength(7);
		expect(screen.queryByRole("link", { name: "Saved 8" })).toBeNull();
		const toggle = screen.getByRole("button", { name: "Show 2 more" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(toggle);

		expect(toggles).toEqual([["savedViews", true]]);
	});

	it("renders every view and offers Show less when expanded", () => {
		renderMany({ expanded: true, activeKey: null });

		expect(screen.getAllByRole("link", { name: /^Saved / })).toHaveLength(9);
		expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
			"true",
		);
	});

	it("auto-expands to reveal an active view in the overflow", () => {
		renderMany({ activeKey: "view:/v/c/saved-8" });

		expect(screen.getByRole("link", { name: "Saved 8" }).getAttribute("aria-current")).toBe("page");
		expect(screen.getAllByRole("link", { name: /^Saved / })).toHaveLength(9);
	});

	it("keeps the active overflow view visible when collapsed explicitly", () => {
		renderMany({ expanded: false, activeKey: "view:/v/c/saved-8" });

		expect(screen.getAllByRole("link", { name: /^Saved / })).toHaveLength(8);
		expect(screen.getByRole("link", { name: "Saved 8" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Show 1 more" })).toBeTruthy();
	});
});
