import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { describe, expect, it } from "vitest";

import {
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
	clientArtifactHash: "artifact-media",
	...overrides,
});

describe("workspace state", () => {
	it("sorts deterministically by sort order, slug, and installation ID", () => {
		const catalog = [
			workspace({ slug: "beta", sortOrder: 1, installationId: "installation-b" }),
			workspace({ slug: "alpha", sortOrder: 1, installationId: "installation-c" }),
			workspace({ slug: "alpha", sortOrder: 1, installationId: "installation-a" }),
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
			workspace({ slug: "disabled", sortOrder: 0, isDisabled: true }),
			workspace({ slug: "failed", sortOrder: 3, health: "failed" }),
			workspace({ slug: "incompatible", sortOrder: 2, health: "incompatible" }),
			workspace({
				sortOrder: 1,
				slug: "missing-client",
				clientApiVersion: null,
				clientArtifactHash: null,
			}),
		];

		expect(visibleWorkspaces(catalog).map(({ slug }) => slug)).toEqual([
			"missing-client",
			"incompatible",
			"failed",
		]);
	});

	it("falls back from a disabled remembered workspace to the first enabled workspace", () => {
		const first = workspace({ slug: "first", sortOrder: 0 });
		const catalog = [
			workspace({ slug: "remembered", sortOrder: -1, isDisabled: true }),
			workspace({ slug: "second", sortOrder: 1 }),
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
});
