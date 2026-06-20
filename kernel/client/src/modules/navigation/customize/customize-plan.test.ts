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

const initial: CustomizeDraft = {
	savedViews: [item("recent", null), item("all", null, true)],
	views: [item("shows", "media"), item("movies", "media")],
};

const build = (draft: CustomizeDraft) =>
	buildCustomizePlan({ draft, initial, workspaceSlug: "media" });

describe("buildCustomizePlan", () => {
	it("plans nothing for an untouched draft", () => {
		expect(build(initial)).toEqual({ updates: [], reorders: [] });
	});

	it("updates only the views whose visibility changed", () => {
		const plan = build({
			...initial,
			views: [item("shows", "media", true), item("movies", "media")],
		});

		expect(plan.updates).toEqual([
			{
				viewSlug: "shows",
				payload: { icon: "list", name: "SHOWS", isDisabled: true, pluginSlug: "media" },
			},
		]);
		expect(plan.reorders).toEqual([]);
	});

	it("omits the plugin slug for a global saved view", () => {
		const plan = build({ ...initial, savedViews: [item("recent", null), item("all", null)] });

		expect(plan.updates).toEqual([
			{ viewSlug: "all", payload: { icon: "list", name: "ALL", isDisabled: false } },
		]);
	});

	it("scopes a workspace reorder to the workspace and a global reorder to no plugin", () => {
		const plan = build({
			views: [item("movies", "media"), item("shows", "media")],
			savedViews: [item("all", null, true), item("recent", null)],
		});

		expect(plan.reorders).toEqual([
			{ pluginSlug: "media", viewSlugs: ["movies", "shows"] },
			{ viewSlugs: ["all", "recent"] },
		]);
	});

	it("reorders hidden views alongside visible ones", () => {
		const plan = build({ ...initial, savedViews: [item("all", null, true), item("recent", null)] });

		expect(plan.reorders).toEqual([{ viewSlugs: ["all", "recent"] }]);
	});

	it("skips the workspace reorder when no workspace is selected", () => {
		const plan = buildCustomizePlan({
			initial,
			workspaceSlug: undefined,
			draft: { ...initial, views: [item("movies", "media"), item("shows", "media")] },
		});

		expect(plan.reorders).toEqual([]);
	});
});
