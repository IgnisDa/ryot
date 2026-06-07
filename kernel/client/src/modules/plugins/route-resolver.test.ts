import type { PluginClientCatalogEntry } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { describe, expect, it } from "vitest";

import { resolveRouteTarget } from "./route-resolver";

const installation = {
	slug: "fixture",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-1",
	sourceHash: "source-hash",
	installationId: "installation-1",
	clientArtifactHash: "artifact-hash",
} satisfies PluginClientCatalogEntry;

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

	it("prefers a compatible installation when duplicate slugs include an incompatible installation", () => {
		const incompatible = { ...installation, health: "incompatible" as const };

		expect(resolveRouteTarget([incompatible, installation], "fixture")).toEqual({
			installation,
			owner: "plugin",
			surface: { kind: "home" },
		});
	});

	it("does not resolve a slug with only an incompatible installation", () => {
		expect(resolveRouteTarget([{ ...installation, health: "incompatible" }], "fixture")).toEqual({
			owner: "kernel",
			surface: { kind: "not-found" },
		});
	});

	it("never resolves a reserved slug to a plugin", () => {
		expect(resolveRouteTarget([{ ...installation, slug: "settings" }], "settings")).toEqual({
			owner: "kernel",
			surface: { kind: "not-found" },
		});
	});
});
