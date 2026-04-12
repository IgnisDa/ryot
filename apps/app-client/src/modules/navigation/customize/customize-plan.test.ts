import { PluginSlug } from "@ryot/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { buildCustomizePlan } from "./customize-plan";
import type { CustomizeDraft } from "./customize-state";

const initial = {
	views: [
		{
			icon: "film",
			isDisabled: false,
			pluginSlug: "media",
			slug: "workspace-view",
			name: "Workspace View",
		},
		{
			icon: "film",
			isDisabled: true,
			pluginSlug: "media",
			slug: "hidden-workspace-view",
			name: "Hidden Workspace View",
		},
	],
	savedViews: [
		{
			icon: "bookmark",
			pluginSlug: null,
			isDisabled: false,
			slug: "saved-view",
			name: "Saved View",
		},
	],
} satisfies CustomizeDraft;

describe("buildCustomizePlan", () => {
	it("updates only changed visibility values", () => {
		const draft = {
			...initial,
			views: initial.views.map((item) =>
				item.slug === "workspace-view" ? { ...item, isDisabled: true } : item,
			),
		};

		expect(buildCustomizePlan({ draft, initial, workspaceSlug: "media" })).toEqual({
			reorders: [],
			updates: [
				{
					viewSlug: "workspace-view",
					payload: {
						icon: "film",
						isDisabled: true,
						name: "Workspace View",
						pluginSlug: PluginSlug.make("media"),
					},
				},
			],
		});
	});

	it("carries workspace pluginSlug and omits global pluginSlug in updates", () => {
		const draft = {
			views: initial.views.map((item) => ({ ...item, isDisabled: false })),
			savedViews: initial.savedViews.map((item) => ({ ...item, isDisabled: true })),
		};

		expect(buildCustomizePlan({ draft, initial, workspaceSlug: "media" }).updates).toEqual([
			{
				viewSlug: "hidden-workspace-view",
				payload: {
					icon: "film",
					isDisabled: false,
					name: "Hidden Workspace View",
					pluginSlug: PluginSlug.make("media"),
				},
			},
			{
				viewSlug: "saved-view",
				payload: { icon: "bookmark", isDisabled: true, name: "Saved View" },
			},
		]);
	});

	it("creates Views then Saved Views reorder requests with the correct plugin fields", () => {
		const draft = {
			views: [...initial.views].toReversed(),
			savedViews: [...initial.savedViews, { ...initial.savedViews[0], slug: "another-saved-view" }],
		};

		expect(buildCustomizePlan({ draft, initial, workspaceSlug: "media" }).reorders).toEqual([
			{
				payload: {
					pluginSlug: PluginSlug.make("media"),
					viewSlugs: ["hidden-workspace-view", "workspace-view"],
				},
			},
			{ payload: { viewSlugs: ["saved-view", "another-saved-view"] } },
		]);
	});

	it("includes hidden items in reorder requests", () => {
		const draft = {
			...initial,
			views: [initial.views[1], initial.views[0]],
		};

		expect(buildCustomizePlan({ draft, initial, workspaceSlug: "media" }).reorders[0]).toEqual({
			payload: {
				pluginSlug: PluginSlug.make("media"),
				viewSlugs: ["hidden-workspace-view", "workspace-view"],
			},
		});
	});

	it("does not reorder unchanged or empty sections", () => {
		const emptyDraft = { views: [], savedViews: [] } satisfies CustomizeDraft;

		expect(
			buildCustomizePlan({ draft: initial, initial, workspaceSlug: "media" }).reorders,
		).toEqual([]);
		expect(
			buildCustomizePlan({ draft: emptyDraft, initial, workspaceSlug: "media" }).reorders,
		).toEqual([]);
	});
});
