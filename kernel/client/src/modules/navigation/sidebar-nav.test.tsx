import type { PluginClientCatalogEntry } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { assert, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { SidebarNav } from "#/modules/navigation/sidebar-nav";
import type { SidebarSections } from "#/modules/navigation/sidebar-sections";

const current: PluginClientCatalogEntry = {
	icon: "film",
	sortOrder: 0,
	name: "Media",
	slug: "media",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-media",
	sourceHash: "source-media",
	installationId: "installation-media",
	clientArtifactHash: "artifact-media",
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
			pluginSlug: null,
			isDisabled: false,
		},
		{
			kind: "view",
			icon: "list",
			sortOrder: 1,
			isDisabled: false,
			name: "Media Queue",
			slug: "media-queue",
			pluginSlug: "media",
		},
	],
};

const renderSidebar = (showSearchShortcut: boolean) =>
	render(
		<SidebarNav
			current={current}
			catalog={[current]}
			sections={sections}
			activeHome={false}
			activeKey="view:media-queue"
			showSearchShortcut={showSearchShortcut}
			onOpenSearch={() => undefined}
			onNavigateHome={() => undefined}
			onNavigateItem={() => undefined}
			onSelectWorkspace={() => undefined}
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
	});

	it("opens search and hides the shortcut when requested", () => {
		let opened = false;
		render(
			<SidebarNav
				current={current}
				catalog={[current]}
				sections={sections}
				activeHome={true}
				activeKey={null}
				showSearchShortcut={false}
				onOpenSearch={() => {
					opened = true;
				}}
				onNavigateHome={() => undefined}
				onNavigateItem={() => undefined}
				onSelectWorkspace={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open command center" }));
		expect(opened).toBe(true);
		expect(screen.queryByText("⌘K")).toBeNull();
		expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
	});

	it("has no accessibility violations", async () => {
		const view = renderSidebar(true);
		const results = await axe(view.container, {
			rules: { "color-contrast": { enabled: false } },
		});
		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});
