import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { describe, expect, it } from "vitest";

import {
	isWorkspaceRoot,
	resolveRememberedWorkspace,
	sortWorkspaces,
	visibleWorkspaces,
} from "#/modules/navigation/workspace-state";
import { effectiveCatalogPlugin } from "#/modules/plugins/catalog/location";

const workspace = (
	overrides: Partial<PluginClientCatalogEntry> = {},
): PluginClientCatalogEntry => ({
	icon: "film",
	sortOrder: 0,
	name: "Media",
	health: "ready",
	isHidden: false,
	clientApiVersion: 1,
	clientEntities: null,
	contentHash: "source-media",
	installationId: "installation-media",
	...overrides,
	scope: overrides.scope ?? "system",
	homeSavedView: overrides.homeSavedView ?? null,
	packageId: overrides.packageId ?? PluginPackageId.make("ryot/media"),
	pluginId:
		overrides.pluginId ?? PluginId.make(`plugin-${overrides.packageId?.split("/")[1] ?? "media"}`),
});

describe("workspace state", () => {
	it("resolves a package route to the compatible record instead of a quarantined one", () => {
		const system = workspace({
			name: "Whiskey",
			installationId: "system-installation",
			pluginId: PluginId.make("system-owner"),
			packageId: PluginPackageId.make("test/whiskey"),
		});
		const retained = workspace({
			scope: "user",
			name: "Whiskey",
			health: "incompatible",
			packageId: system.packageId,
			installationId: "private-installation",
			pluginId: PluginId.make("private-owner"),
		});
		const catalog = [retained, system];
		expect(visibleWorkspaces(catalog)).toEqual([system]);
		expect(effectiveCatalogPlugin(catalog, system.packageId)).toBe(system);
	});
	it("sorts deterministically by sort order, package ID, and installation ID", () => {
		const catalog = [
			workspace({
				sortOrder: 1,
				installationId: "installation-b",
				packageId: PluginPackageId.make("test/beta"),
			}),
			workspace({
				sortOrder: 1,
				installationId: "installation-c",
				packageId: PluginPackageId.make("test/alpha"),
			}),
			workspace({
				sortOrder: 1,
				installationId: "installation-a",
				packageId: PluginPackageId.make("test/alpha"),
			}),
			workspace({
				sortOrder: 0,
				installationId: "installation-z",
				packageId: PluginPackageId.make("test/zeta"),
			}),
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
			workspace({ sortOrder: 0, isHidden: true, packageId: PluginPackageId.make("test/disabled") }),
			workspace({ sortOrder: 3, health: "failed", packageId: PluginPackageId.make("test/failed") }),
			workspace({
				sortOrder: 2,
				health: "incompatible",
				packageId: PluginPackageId.make("test/incompatible"),
			}),
		];

		expect(visibleWorkspaces(catalog)).toEqual([]);
	});

	it("falls back from a hidden remembered workspace to the first enabled workspace", () => {
		const first = workspace({ sortOrder: 0, packageId: PluginPackageId.make("test/first") });
		const catalog = [
			workspace({
				sortOrder: -1,
				isHidden: true,
				packageId: PluginPackageId.make("test/remembered"),
			}),
			workspace({ sortOrder: 1, packageId: PluginPackageId.make("test/second") }),
			first,
		];

		expect(resolveRememberedWorkspace(catalog, "plugin-remembered")).toBe(first);
		expect(resolveRememberedWorkspace(catalog, "plugin-second")?.packageId).toBe("test/second");
	});

	it("derives plugin-route workspace context", () => {
		const catalog = [
			workspace({ packageId: PluginPackageId.make("test/media") }),
			workspace({ packageId: PluginPackageId.make("test/fitness") }),
			workspace({ isHidden: true, packageId: PluginPackageId.make("test/disabled") }),
		];

		expect(effectiveCatalogPlugin(catalog, PluginPackageId.make("test/fitness"))?.packageId).toBe(
			"test/fitness",
		);
		expect(effectiveCatalogPlugin(catalog, PluginPackageId.make("test/disabled"))?.packageId).toBe(
			"test/disabled",
		);
		expect(effectiveCatalogPlugin(catalog, PluginPackageId.make("test/missing"))).toBeUndefined();
	});

	it("keeps direct routes resolvable when no workspace is enabled", () => {
		const catalog = [workspace({ isHidden: true })];

		expect(visibleWorkspaces(catalog)).toEqual([]);
		expect(resolveRememberedWorkspace(catalog, "plugin-media")).toBeNull();
		expect(effectiveCatalogPlugin(catalog, PluginPackageId.make("ryot/media"))?.packageId).toBe(
			"ryot/media",
		);
	});

	it("recognizes a workspace root with or without a trailing slash", () => {
		const media = workspace();

		expect(isWorkspaceRoot("/p/ryot/media", media)).toBe(true);
		expect(isWorkspaceRoot("/p/ryot/media/", media)).toBe(true);
	});

	it("rejects child routes, other workspaces, and an absent workspace", () => {
		const media = workspace();

		expect(isWorkspaceRoot("/p/ryot/media/workouts/1", media)).toBe(false);
		expect(isWorkspaceRoot("/mediation", media)).toBe(false);
		expect(isWorkspaceRoot("/p/ryot/fitness", media)).toBe(false);
		expect(isWorkspaceRoot("/v/k/all-movies", media)).toBe(false);
		expect(isWorkspaceRoot("/p/ryot/media", null)).toBe(false);
	});
});
