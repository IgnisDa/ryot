import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { assert } from "vitest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { fixtureManifest } from "./test-support";
import { validatePluginManifestReferences } from "./validation";

const cronManifest = () => {
	const manifest = fixtureManifest();
	const script = manifest.scripts[0];
	assert(script);
	return {
		...manifest,
		crons: [
			{
				slug: "fixture-cron",
				lot: "script" as const,
				scriptSlug: script.slug,
				description: "Fixture cron",
				schedule: { cron: "* * * * *" },
			},
		],
	};
};

it.effect("rejects duplicate cron slugs, unknown scripts, and invalid schedules", () => {
	const cases = [
		(manifest: ReturnType<typeof cronManifest>) => {
			const cron = manifest.crons[0];
			assert(cron);
			return { ...manifest, crons: [...manifest.crons, { ...cron }] };
		},
		(manifest: ReturnType<typeof cronManifest>) => {
			const cron = manifest.crons[0];
			assert(cron);
			return { ...manifest, crons: [{ ...cron, scriptSlug: "missing-script" }] };
		},
		(manifest: ReturnType<typeof cronManifest>) => {
			const cron = manifest.crons[0];
			assert(cron);
			return { ...manifest, crons: [{ ...cron, schedule: { cron: "not a cron" } }] };
		},
	];
	const snapshot = makeDefinitionRegistry().getSnapshot();

	return Effect.forEach(cases, (mutate) => {
		const manifest = mutate(cronManifest());
		return Effect.gen(function* () {
			const exit = yield* Effect.exit(validatePluginManifestReferences(manifest, snapshot));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});
});
