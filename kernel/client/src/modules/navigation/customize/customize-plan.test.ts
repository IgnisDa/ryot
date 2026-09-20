import { PluginId, PluginPackageId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { buildCustomizePlan } from "#/modules/navigation/customize/customize-plan";
import type { CustomizeDraft } from "#/modules/navigation/customize/customize-state";

const reference = (slug: string) => ({
	kind: "custom" as const,
	savedViewId: SavedViewId.make(slug),
});
const item = (slug: string, pluginInstallationId: string | null, isHidden = false) => ({
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
	workspaces: [workspace("media"), workspace("fitness")],
	views: [item("shows", "media"), item("movies", "media")],
	savedViews: [item("recent", null), item("all", null, true)],
};

const build = (draft: CustomizeDraft) =>
	buildCustomizePlan({ draft, initial, workspaceInstallationId: "media" });

describe("buildCustomizePlan", () => {
	it("plans nothing for an untouched draft", () => {
		expect(build(initial)).toEqual({ updates: [], reorders: [], workspaceUpdates: [] });
	});

	it("updates only the views whose visibility changed", () => {
		const plan = build({
			...initial,
			views: [item("shows", "media", true), item("movies", "media")],
		});

		expect(plan.updates).toEqual([{ payload: { isHidden: true }, reference: reference("shows") }]);
		expect(plan.reorders).toEqual([]);
		expect(plan.workspaceUpdates).toEqual([]);
	});

	it("updates only the workspaces whose visibility changed", () => {
		const plan = build({
			...initial,
			workspaces: [workspace("media", true), workspace("fitness")],
		});

		expect(plan.workspaceUpdates).toEqual([
			{ installationId: "media", payload: { isHidden: true } },
		]);
		expect(plan.updates).toEqual([]);
		expect(plan.reorders).toEqual([]);
	});

	it("updates every workspace when its order changes", () => {
		const plan = build({
			...initial,
			workspaces: [workspace("fitness"), workspace("media", true)],
		});

		expect(plan.workspaceUpdates).toEqual([
			{ installationId: "fitness", payload: { sortOrder: 0 } },
			{ installationId: "media", payload: { sortOrder: 1, isHidden: true } },
		]);
	});

	it("toggles a global saved view without sending definition content", () => {
		const plan = build({ ...initial, savedViews: [item("recent", null), item("all", null)] });

		expect(plan.updates).toEqual([{ reference: reference("all"), payload: { isHidden: false } }]);
	});

	it("scopes a workspace reorder to the workspace and a global reorder to no plugin", () => {
		const plan = build({
			workspaces: initial.workspaces,
			views: [item("movies", "media"), item("shows", "media")],
			savedViews: [item("all", null, true), item("recent", null)],
		});

		expect(plan.reorders).toEqual([
			{ installationId: "media", references: [reference("movies"), reference("shows")] },
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
			draft: { ...initial, views: [item("movies", "media"), item("shows", "media")] },
		});

		expect(plan.reorders).toEqual([]);
		expect(plan.workspaceUpdates).toEqual([]);
	});
});
