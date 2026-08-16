import { it } from "@effect/vitest";
import { reservedPluginSlugs } from "@ryot/contract/modules/plugins/schemas";
import { Effect } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import { fixtureManifest } from "./test-support";
import { PluginSlugReservedError, validatePluginManifestPolicy } from "./validation";

const manifestWithSlug = (slug: string) => {
	const manifest = fixtureManifest();
	return { ...manifest, metadata: { ...manifest.metadata, slug } };
};

const policies = [
	{ scope: "system" },
	{ scope: "user", systemSlugs: new Set<string>() },
] as const satisfies ReadonlyArray<Parameters<typeof validatePluginManifestPolicy>[1]>;

it.effect("rejects client route slugs in every scope", () =>
	Effect.forEach(policies, (policy) =>
		Effect.forEach([...reservedPluginSlugs], (pluginSlug) =>
			Effect.exit(validatePluginManifestPolicy(manifestWithSlug(pluginSlug), policy)).pipe(
				Effect.map((exit) => assertExitFails(exit, new PluginSlugReservedError({ pluginSlug }))),
			),
		),
	),
);

it.effect("accepts a slug outside the client route space", () =>
	Effect.forEach(policies, (policy) =>
		validatePluginManifestPolicy(manifestWithSlug("settings-helper"), policy),
	),
);
