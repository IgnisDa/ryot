import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { describe, expect, it } from "vitest";

import {
	isWorkspaceRoot,
	resolvePluginRouteWorkspace,
	resolveRememberedWorkspace,
	sortWorkspaces,
	visibleWorkspaces,
} from "#/modules/navigation/workspace-state";

const workspace = (
	overrides: Partial<PluginClientCatalogEntry> = {},
): PluginClientCatalogEntry => ({
	icon: "film",
	sortOrder: 0,
	name: "Media",
	slug: "media",
	health: "ready",
	isHidden: false,
	clientApiVersion: 1,
	sourceHash: "source-media",
	installationId: "installation-media",
	...overrides,
	scope: overrides.scope ?? "system",
	homeSavedView: overrides.homeSavedView ?? null,
	pluginId: overrides.pluginId ?? `plugin-${overrides.slug ?? "media"}`,
	packageId: overrides.packageId ?? PluginPackageId.make("ff9c9ec6-5774-42ef-881b-dc6a84ad3ba6"),
});

describe("workspace state", () => {
	it("does not substitute a same-name system record for a quarantined local route", () => {
		const system = workspace({
			name: "Whiskey",
			slug: "whiskey",
			pluginId: "system-owner",
			installationId: "system-installation",
		});
		const retained = workspace({
			scope: "user",
			name: "Whiskey",
			slug: "whiskey",
			health: "incompatible",
			pluginId: "private-owner",
			packageId: system.packageId,
			installationId: "private-installation",
		});
		const catalog = [retained, system];
		expect(visibleWorkspaces(catalog)).toEqual([system]);
		expect(resolvePluginRouteWorkspace(catalog, retained.pluginId)).toBe(retained);
		expect(resolvePluginRouteWorkspace(catalog, system.pluginId)).toBe(system);
	});
	it("sorts deterministically by sort order, slug, and installation ID", () => {
		const catalog = [
			workspace({ slug: "beta", sortOrder: 1, installationId: "installation-b" }),
			workspace({ sortOrder: 1, slug: "alpha", installationId: "installation-c" }),
			workspace({ sortOrder: 1, slug: "alpha", installationId: "installation-a" }),
			workspace({ slug: "zeta", sortOrder: 0, installationId: "installation-z" }),
		];

		expect(sortWorkspaces(catalog).map(({ installationId }) => installationId)).toEqual([
			"installation-z",
			"installation-a",
			"installation-c",
			"installation-b",
		]);
		expect(catalog.map(({ installationId }) => installationId)).toEqual([
			"installation-b",
			"installation-c",
			"installation-a",
			"installation-z",
		]);
	});

	it("keeps unavailable and hidden records out of executable workspaces", () => {
		const catalog: PluginClientCatalog = [
			workspace({ sortOrder: 0, isHidden: true, slug: "disabled" }),
			workspace({ sortOrder: 3, slug: "failed", health: "failed" }),
			workspace({ sortOrder: 2, slug: "incompatible", health: "incompatible" }),
		];

		expect(visibleWorkspaces(catalog)).toEqual([]);
	});

	it("falls back from a hidden remembered workspace to the first enabled workspace", () => {
		const first = workspace({ sortOrder: 0, slug: "first" });
		const catalog = [
			workspace({ sortOrder: -1, isHidden: true, slug: "remembered" }),
			workspace({ sortOrder: 1, slug: "second" }),
			first,
		];

		expect(resolveRememberedWorkspace(catalog, "plugin-remembered")).toBe(first);
		expect(resolveRememberedWorkspace(catalog, "plugin-second")?.slug).toBe("second");
	});

	it("derives plugin-route workspace context", () => {
		const catalog = [
			workspace({ slug: "media" }),
			workspace({ slug: "fitness" }),
			workspace({ isHidden: true, slug: "disabled" }),
		];

		expect(resolvePluginRouteWorkspace(catalog, "plugin-fitness")?.slug).toBe("fitness");
		expect(resolvePluginRouteWorkspace(catalog, "plugin-disabled")?.slug).toBe("disabled");
		expect(resolvePluginRouteWorkspace(catalog, "missing")).toBeNull();
	});

	it("keeps direct routes resolvable when no workspace is enabled", () => {
		const catalog = [workspace({ isHidden: true })];

		expect(visibleWorkspaces(catalog)).toEqual([]);
		expect(resolveRememberedWorkspace(catalog, "plugin-media")).toBeNull();
		expect(resolvePluginRouteWorkspace(catalog, "plugin-media")?.slug).toBe("media");
	});

	it("recognizes a workspace root with or without a trailing slash", () => {
		const media = workspace();

		expect(isWorkspaceRoot("/p/plugin-media", media)).toBe(true);
		expect(isWorkspaceRoot("/p/plugin-media/", media)).toBe(true);
	});

	it("rejects child routes, other workspaces, and an absent workspace", () => {
		const media = workspace();

		expect(isWorkspaceRoot("/p/plugin-media/workouts/1", media)).toBe(false);
		expect(isWorkspaceRoot("/mediation", media)).toBe(false);
		expect(isWorkspaceRoot("/p/plugin-fitness", media)).toBe(false);
		expect(isWorkspaceRoot("/v/k/all-movies", media)).toBe(false);
		expect(isWorkspaceRoot("/p/plugin-media", null)).toBe(false);
	});
});
