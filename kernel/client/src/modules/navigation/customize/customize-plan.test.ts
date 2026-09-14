import { describe, expect, it } from "vitest";

import { buildCustomizePlan } from "#/modules/navigation/customize/customize-plan";
import type { CustomizeDraft } from "#/modules/navigation/customize/customize-state";

const item = (slug: string, pluginSlug: string | null, isDisabled = false) => ({
	slug,
	isDisabled,
	pluginSlug,
	icon: "list",
	name: slug.toUpperCase(),
});

const workspace = (slug: string, isDisabled = false) => ({
	slug,
	isDisabled,
	icon: "plugin",
	name: slug.toUpperCase(),
});

const initial: CustomizeDraft = {
	workspaces: [workspace("media"), workspace("fitness")],
	views: [item("shows", "media"), item("movies", "media")],
	savedViews: [item("recent", null), item("all", null, true)],
};

const build = (draft: CustomizeDraft) =>
	buildCustomizePlan({ draft, initial, workspaceSlug: "media" });

describe("buildCustomizePlan", () => {
	it("plans nothing for an untouched draft", () => {
		expect(build(initial)).toEqual({ updates: [], reorders: [], workspaceUpdates: [] });
	});

	it("updates only the views whose visibility changed", () => {
		const plan = build({
			...initial,
			views: [item("shows", "media", true), item("movies", "media")],
		});

		expect(plan.updates).toEqual([
			{
				viewSlug: "shows",
				payload: { icon: "list", name: "SHOWS", isDisabled: true, workspacePluginSlug: "media" },
			},
		]);
		expect(plan.reorders).toEqual([]);
		expect(plan.workspaceUpdates).toEqual([]);
	});

	it("updates only the workspaces whose visibility changed", () => {
		const plan = build({
			...initial,
			workspaces: [workspace("media", true), workspace("fitness")],
		});

		expect(plan.workspaceUpdates).toEqual([{ pluginSlug: "media", payload: { isDisabled: true } }]);
		expect(plan.updates).toEqual([]);
		expect(plan.reorders).toEqual([]);
	});

	it("updates every workspace when its order changes", () => {
		const plan = build({
			...initial,
			workspaces: [workspace("fitness"), workspace("media", true)],
		});

		expect(plan.workspaceUpdates).toEqual([
			{ pluginSlug: "fitness", payload: { sortOrder: 0 } },
			{ pluginSlug: "media", payload: { sortOrder: 1, isDisabled: true } },
		]);
	});

	it("omits the plugin slug for a global saved view", () => {
		const plan = build({ ...initial, savedViews: [item("recent", null), item("all", null)] });

		expect(plan.updates).toEqual([
			{ viewSlug: "all", payload: { name: "ALL", icon: "list", isDisabled: false } },
		]);
	});

	it("scopes a workspace reorder to the workspace and a global reorder to no plugin", () => {
		const plan = build({
			workspaces: initial.workspaces,
			views: [item("movies", "media"), item("shows", "media")],
			savedViews: [item("all", null, true), item("recent", null)],
		});

		expect(plan.reorders).toEqual([
			{ pluginSlug: "media", viewSlugs: ["movies", "shows"] },
			{ viewSlugs: ["all", "recent"] },
		]);
		expect(plan.workspaceUpdates).toEqual([]);
	});

	it("reorders hidden views alongside visible ones", () => {
		const plan = build({ ...initial, savedViews: [item("all", null, true), item("recent", null)] });

		expect(plan.reorders).toEqual([{ viewSlugs: ["all", "recent"] }]);
		expect(plan.workspaceUpdates).toEqual([]);
	});

	it("skips the workspace reorder when no workspace is selected", () => {
		const plan = buildCustomizePlan({
			initial,
			workspaceSlug: undefined,
			draft: { ...initial, views: [item("movies", "media"), item("shows", "media")] },
		});

		expect(plan.reorders).toEqual([]);
		expect(plan.workspaceUpdates).toEqual([]);
	});
});
