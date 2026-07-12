import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { assert } from "vitest";

import { fixtureManifest } from "./test-support";
import { decodePluginManifest } from "./validation";

const providerManifest = () => {
	const manifest = fixtureManifest();
	const script = manifest.scripts[0];
	assert(script);
	const details = {
		...script,
		kind: "provider" as const,
		name: "Fixture details",
		slug: "fixture.details",
		providerSlug: "fixture-provider",
		providerOperation: "details" as const,
	};
	return {
		...manifest,
		scripts: [...manifest.scripts, details],
		providers: [
			{
				name: "Fixture provider",
				slug: "fixture-provider",
				information: { source: "fixture" },
				operations: { details: details.slug },
			},
		],
		bindings: {
			...manifest.bindings,
			schemaProviderLinks: [
				{ providerSlug: "fixture-provider", entitySchemaSlug: "fixture-entity" },
			],
		},
	};
};

it.effect("accepts explicit providers, operation mappings, and schema membership", () =>
	Effect.gen(function* () {
		const decoded = yield* decodePluginManifest(providerManifest());
		expect(decoded.providers[0]).toMatchObject({
			slug: "fixture-provider",
			operations: { details: "fixture.details" },
		});
		expect(decoded.bindings.schemaProviderLinks).toEqual([
			{ providerSlug: "fixture-provider", entitySchemaSlug: "fixture-entity" },
		]);
	}),
);

it.effect(
	"rejects missing providers and invalid operation mappings through the manifest schema",
	() => {
		const manifest = providerManifest();
		const provider = manifest.providers[0];
		assert(provider);
		const cases = [
			{ ...manifest, providers: [] },
			{
				...manifest,
				providers: [
					{
						...provider,
						operations: { details: "fixture.automation" },
					},
				],
			},
		];
		return Effect.forEach(cases, (candidate) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(decodePluginManifest(candidate));
				expect(Exit.isFailure(exit)).toBe(true);
				expect(String(exit)).toContain(
					"Expected valid plugin config, provider, and script references",
				);
			}),
		);
	},
);
