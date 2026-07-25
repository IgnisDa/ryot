import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import type { EntityRouteProvenance } from "@ryot-app/ryotql-recipes/entities";
import type { PluginClientCatalogEntry } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { describe, expect, it } from "vitest";

import { resolveEntityRouteTarget, resolveRouteTarget } from "#/modules/plugins/route-resolver";

const installation = {
	sortOrder: 0,
	icon: "puzzle",
	name: "Fixture",
	slug: "fixture",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-1",
	sourceHash: "source-hash",
	installationId: "installation-1",
	clientArtifactHash: "artifact-hash",
} satisfies PluginClientCatalogEntry;

const routeProvenance = (
	entitySchemaPluginId: string | null,
): NonNullable<EntityRouteProvenance> => ({
	entitySchemaPluginId,
	entitySchemaSlug: EntitySchemaSlug.make("book"),
});

describe("plugin route resolver", () => {
	it("resolves an installed plugin slug to its home", () => {
		expect(resolveRouteTarget([installation], "fixture")).toEqual({
			installation,
			owner: "plugin",
			surface: { kind: "home" },
		});
	});

	it("resolves an unknown slug to the kernel not-found surface", () => {
		expect(resolveRouteTarget([installation], "missing")).toEqual({
			owner: "kernel",
			surface: { kind: "not-found" },
		});
	});

	it("uses the first catalog entry when duplicate slugs have different health", () => {
		const incompatible = { ...installation, health: "incompatible" as const };

		expect(resolveRouteTarget([incompatible, installation], "fixture")).toEqual({
			owner: "plugin",
			surface: { kind: "home" },
			installation: incompatible,
		});
	});

	it("resolves an incompatible installation to plugin ownership", () => {
		const incompatible = { ...installation, health: "incompatible" as const };

		expect(resolveRouteTarget([incompatible], "fixture")).toEqual({
			owner: "plugin",
			surface: { kind: "home" },
			installation: incompatible,
		});
	});

	it("never resolves a reserved slug to a plugin", () => {
		expect(resolveRouteTarget([{ ...installation, slug: "settings" }], "settings")).toEqual({
			owner: "kernel",
			surface: { kind: "not-found" },
		});
	});

	it("never resolves the oauth slug to a plugin", () => {
		expect(resolveRouteTarget([{ ...installation, slug: "oauth" }], "oauth")).toEqual({
			owner: "kernel",
			surface: { kind: "not-found" },
		});
	});
});

describe("entity route resolver", () => {
	it("resolves a missing entity", () => {
		expect(resolveEntityRouteTarget([installation], "entity-1", null)).toEqual({
			kind: "missing",
		});
	});

	it("resolves a kernel-owned entity as unsupported", () => {
		expect(resolveEntityRouteTarget([installation], "entity-1", routeProvenance(null))).toEqual({
			kind: "unsupported",
			owner: "kernel",
		});
	});

	it("resolves a plugin-owned entity without an installation", () => {
		expect(
			resolveEntityRouteTarget([installation], "entity-1", routeProvenance("missing-plugin")),
		).toEqual({ kind: "installation-missing" });
	});

	it("selects an installation by exact plugin ID", () => {
		const misleading = { ...installation, pluginId: "other-plugin", slug: "book" };
		const target = { ...installation, slug: "other" };

		expect(
			resolveEntityRouteTarget([misleading, target], "entity-1", routeProvenance("plugin-1")),
		).toEqual({
			kind: "plugin",
			entityId: "entity-1",
			entitySchemaSlug: "book",
			installation: target,
		});
	});

	it.each([
		["disabled", { isDisabled: true }],
		["incompatible", { health: "incompatible" as const }],
	])("resolves a %s installation", (_state, changes) => {
		const candidate = { ...installation, ...changes };

		expect(resolveEntityRouteTarget([candidate], "entity-1", routeProvenance("plugin-1"))).toEqual({
			kind: "plugin",
			entityId: "entity-1",
			entitySchemaSlug: "book",
			installation: candidate,
		});
	});
});
