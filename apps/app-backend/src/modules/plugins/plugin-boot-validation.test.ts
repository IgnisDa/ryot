import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { assert } from "vitest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { fixtureManifest } from "./test-support";
import { validatePluginManifestReferences } from "./validation";

const bootManifest = () => {
	const manifest = fixtureManifest();
	const script = manifest.scripts[0];
	assert(script);
	return {
		...manifest,
		boot: [{ slug: "fixture-boot", scriptSlug: script.slug, description: "Fixture boot" }],
	};
};

it.effect("rejects duplicate boot slugs and unknown scripts", () => {
	const cases = [
		(manifest: ReturnType<typeof bootManifest>) => {
			const boot = manifest.boot[0];
			assert(boot);
			return { ...manifest, boot: [...manifest.boot, { ...boot }] };
		},
		(manifest: ReturnType<typeof bootManifest>) => {
			const boot = manifest.boot[0];
			assert(boot);
			return { ...manifest, boot: [{ ...boot, scriptSlug: "missing-script" }] };
		},
	];
	const snapshot = makeDefinitionRegistry().getSnapshot();

	return Effect.forEach(cases, (mutate) => {
		const manifest = mutate(bootManifest());
		return Effect.gen(function* () {
			const exit = yield* Effect.exit(validatePluginManifestReferences(manifest, snapshot));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});
});
