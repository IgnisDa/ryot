import { assert, describe, expect, it } from "@effect/vitest";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
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
	name: "Media",
	health: "ready",
	isHidden: false,
	scope: "system",
	clientApiVersion: 1,
	homeSavedView: null,
	clientEntities: null,
	contentHash: "source-media",
	installationId: "installation-media",
	pluginId: PluginId.make("plugin-media"),
	packageId: PluginPackageId.make("ryot/media"),
};

const navigation: NavigationData = {
	collections: [],
	savedViews: [
		{
			icon: "list",
			sortOrder: 1,
			isHidden: false,
			slug: "media-queue",
			name: "Media Queue",
			pluginInstallationId: "installation-media",
			packageId: PluginPackageId.make("ryot/media"),
			reference: { kind: "plugin", slug: "media-queue", pluginId: PluginId.make("plugin-media") },
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
			name: "Media Queue",
			slug: "media-queue",
			pluginInstallationId: "installation-media",
			packageId: PluginPackageId.make("ryot/media"),
			reference: { kind: "plugin", slug: "media-queue", pluginId: PluginId.make("plugin-media") },
		},
	],
};

const renderSidebar = (
	showSearchShortcut: boolean,
	customize?: {
		readonly onCustomize?: () => void;
		readonly onEditSection?: (section: "views" | "savedViews") => void;
	},
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
			showSearchShortcut={showSearchShortcut}
			onEditSection={customize?.onEditSection}
			activeKey="view:/v/p/ryot/media/media-queue"
			onWorkspaceSwitcherOpenChange={() => undefined}
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
		expect(screen.getByRole("link", { name: "Media Queue" }).getAttribute("aria-current")).toBe(
			"page",
		);
		expect(screen.getByText("⌘K")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Open command center" }).getAttribute("aria-keyshortcuts"),
		).toBe("Mod+K");
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
				onWorkspaceSwitcherOpenChange={() => undefined}
				onOpenSearch={() => {
					opened = true;
				}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open command center" }));
		expect(opened).toBe(true);
		expect(screen.queryByText("⌘K")).toBeNull();
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
