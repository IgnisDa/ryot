import { it } from "@effect/vitest";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { fixtureManifest } from "./test-support";
import { validatePluginManifestPolicy } from "./validation";

const manifestWithSlug = (slug: string) => {
	const manifest = fixtureManifest();
	return { ...manifest, metadata: { ...manifest.metadata, slug } };
};

const policies = [
	{ scope: "system" },
	{ scope: "user", systemPackageIds: new Set<PluginPackageId>() },
] as const satisfies ReadonlyArray<Parameters<typeof validatePluginManifestPolicy>[1]>;

it.effect("allows route-like local names in every plugin scope", () =>
	Effect.forEach(policies, (policy) =>
		Effect.forEach(["settings", "god-mode", "e", "p", "v"], (slug) =>
			validatePluginManifestPolicy(manifestWithSlug(slug), policy),
		),
	),
);
