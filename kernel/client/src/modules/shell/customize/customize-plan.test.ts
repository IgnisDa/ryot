import { PluginId, PluginPackageId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { buildCustomizePlan } from "#/modules/shell/customize/customize-plan";
import type { CustomizeDraft } from "#/modules/shell/customize/customize-state";

const reference = (slug: string) => ({
	kind: "custom" as const,
	savedViewId: SavedViewId.make(slug),
});
const item = (slug: string, pluginInstallationId: null | string, isHidden = false) => ({
	slug,
	isHidden,
	icon: "list",
	id: `/v/c/${slug}`,
	pluginInstallationId,
	name: slug.toUpperCase(),
	reference: reference(slug),
});

const workspace = (slug: string, isHidden = false) => ({
	slug,
	id: slug,
	isHidden,
	icon: "plugin",
	installationId: slug,
	name: slug.toUpperCase(),
	pluginId: PluginId.make(`plugin-${slug}`),
	packageId: PluginPackageId.make(`test/${slug}`),
});

const initial: CustomizeDraft = {
	workspaces: [workspace("fixture"), workspace("other")],
	savedViews: [item("recent", null), item("all", null, true)],
	views: [item("items", "fixture"), item("records", "fixture")],
};

const build = (draft: CustomizeDraft) =>
	buildCustomizePlan({ draft, initial, workspaceInstallationId: "fixture" });

describe("buildCustomizePlan", () => {
	it("plans nothing for an untouched draft", () => {
		expect(build(initial)).toEqual({ updates: [], reorders: [], workspaceUpdates: [] });
	});

	it("updates only the views whose visibility changed", () => {
		const plan = build({
			...initial,
			views: [item("items", "fixture", true), item("records", "fixture")],
		});

		expect(plan.updates).toEqual([{ payload: { isHidden: true }, reference: reference("items") }]);
		expect(plan.reorders).toEqual([]);
		expect(plan.workspaceUpdates).toEqual([]);
	});

	it("updates only the workspaces whose visibility changed", () => {
		const plan = build({
			...initial,
			workspaces: [workspace("fixture", true), workspace("other")],
		});

		expect(plan.workspaceUpdates).toEqual([
			{ installationId: "fixture", payload: { isHidden: true } },
		]);
		expect(plan.updates).toEqual([]);
		expect(plan.reorders).toEqual([]);
	});

	it("updates every workspace when its order changes", () => {
		const plan = build({
			...initial,
			workspaces: [workspace("other"), workspace("fixture", true)],
		});

		expect(plan.workspaceUpdates).toEqual([
			{ installationId: "other", payload: { sortOrder: 0 } },
			{ installationId: "fixture", payload: { sortOrder: 1, isHidden: true } },
		]);
	});

	it("toggles a global saved view without sending definition content", () => {
		const plan = build({ ...initial, savedViews: [item("recent", null), item("all", null)] });

		expect(plan.updates).toEqual([{ reference: reference("all"), payload: { isHidden: false } }]);
	});

	it("scopes a workspace reorder to the workspace and a global reorder to no plugin", () => {
		const plan = build({
			workspaces: initial.workspaces,
			savedViews: [item("all", null, true), item("recent", null)],
			views: [item("records", "fixture"), item("items", "fixture")],
		});

		expect(plan.reorders).toEqual([
			{ installationId: "fixture", references: [reference("records"), reference("items")] },
			{ references: [reference("all"), reference("recent")] },
		]);
		expect(plan.workspaceUpdates).toEqual([]);
	});

	it("reorders hidden views alongside visible ones", () => {
		const plan = build({ ...initial, savedViews: [item("all", null, true), item("recent", null)] });

		expect(plan.reorders).toEqual([{ references: [reference("all"), reference("recent")] }]);
		expect(plan.workspaceUpdates).toEqual([]);
	});

	it("skips the workspace reorder when no workspace is selected", () => {
		const plan = buildCustomizePlan({
			initial,
			workspaceInstallationId: undefined,
			draft: { ...initial, views: [item("records", "fixture"), item("items", "fixture")] },
		});

		expect(plan.reorders).toEqual([]);
		expect(plan.workspaceUpdates).toEqual([]);
	});
});
