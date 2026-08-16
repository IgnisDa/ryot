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
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-media",
	sourceHash: "source-media",
	installationId: "installation-media",
	...overrides,
	homeSavedViewSlug: overrides.homeSavedViewSlug ?? null,
});

describe("workspace state", () => {
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

	it("filters only disabled workspaces and sorts all other catalog states", () => {
		const catalog: PluginClientCatalog = [
			workspace({ sortOrder: 0, slug: "disabled", isDisabled: true }),
			workspace({ sortOrder: 3, slug: "failed", health: "failed" }),
			workspace({ sortOrder: 2, slug: "incompatible", health: "incompatible" }),
		];

		expect(visibleWorkspaces(catalog).map(({ slug }) => slug)).toEqual(["incompatible", "failed"]);
	});

	it("falls back from a disabled remembered workspace to the first enabled workspace", () => {
		const first = workspace({ sortOrder: 0, slug: "first" });
		const catalog = [
			workspace({ sortOrder: -1, isDisabled: true, slug: "remembered" }),
			workspace({ sortOrder: 1, slug: "second" }),
			first,
		];

		expect(resolveRememberedWorkspace(catalog, "remembered")).toBe(first);
		expect(resolveRememberedWorkspace(catalog, "second")?.slug).toBe("second");
	});

	it("derives plugin-route workspace context", () => {
		const catalog = [
			workspace({ slug: "media" }),
			workspace({ slug: "fitness" }),
			workspace({ slug: "disabled", isDisabled: true }),
		];

		expect(resolvePluginRouteWorkspace(catalog, "fitness")?.slug).toBe("fitness");
		expect(resolvePluginRouteWorkspace(catalog, "disabled")?.slug).toBe("disabled");
		expect(resolvePluginRouteWorkspace(catalog, "missing")).toBeNull();
	});

	it("keeps direct routes resolvable when no workspace is enabled", () => {
		const catalog = [workspace({ isDisabled: true })];

		expect(visibleWorkspaces(catalog)).toEqual([]);
		expect(resolveRememberedWorkspace(catalog, "media")).toBeNull();
		expect(resolvePluginRouteWorkspace(catalog, "media")?.slug).toBe("media");
	});

	it("recognizes a workspace root with or without a trailing slash", () => {
		const media = workspace();

		expect(isWorkspaceRoot("/media", media)).toBe(true);
		expect(isWorkspaceRoot("/media/", media)).toBe(true);
	});

	it("rejects child routes, other workspaces, and an absent workspace", () => {
		const media = workspace();

		expect(isWorkspaceRoot("/media/workouts/1", media)).toBe(false);
		expect(isWorkspaceRoot("/mediation", media)).toBe(false);
		expect(isWorkspaceRoot("/fitness", media)).toBe(false);
		expect(isWorkspaceRoot("/v/all-movies", media)).toBe(false);
		expect(isWorkspaceRoot("/media", null)).toBe(false);
	});
});
