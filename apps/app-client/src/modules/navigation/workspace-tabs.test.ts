import { describe, expect, it } from "vitest";

import type { NavigationItem } from "./navigation-data";
import { getSelectedWorkspaceTabKey, getWorkspaceTabs } from "./workspace-tabs";

const view = (name: string, slug: string): NavigationItem => ({
	name,
	slug,
	icon: "film",
	kind: "view",
	sortOrder: 1,
	isDisabled: false,
	pluginSlug: "media",
	accentColor: "#fd7e14",
});

describe("workspace tabs", () => {
	it("uses the first four views and adds more", () => {
		const tabs = getWorkspaceTabs({
			views: [
				{ ...view("Home", "home"), kind: "home" },
				view("Movies", "movies"),
				view("Shows", "shows"),
				view("Books", "books"),
				view("Music", "music"),
			],
		});

		expect(tabs.map((tab) => tab.key)).toEqual([
			"home",
			"view:movies",
			"view:shows",
			"view:books",
			"more",
		]);
	});

	it("keeps a direct tab selected for views opened from more", () => {
		const tabs = getWorkspaceTabs({ views: [view("Movies", "movies")] });

		expect(getSelectedWorkspaceTabKey("view:movies", tabs)).toBe("view:movies");
		expect(getSelectedWorkspaceTabKey("view:music", tabs)).toBe("view:movies");
	});
});
