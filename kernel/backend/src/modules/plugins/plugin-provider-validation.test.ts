import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { assert } from "vitest";

import { fixtureManifest } from "./test-support";
import { decodePluginManifest } from "./validation";

const providerManifest = () => {
	const manifest = fixtureManifest();
	const script = manifest.scripts[0];
	assert(script);
	const { automationType: _automationType, inputProjection: _inputProjection, ...common } = script;
	const details = {
		...common,
		name: "Fixture details",
		slug: "fixture.details",
		kind: "provider" as const,
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
				rootEntitySchemaSlug: "fixture-entity",
			},
		],
	};
};

it.effect("accepts explicit providers and operation mappings", () =>
	Effect.gen(function* () {
		const decoded = yield* decodePluginManifest(providerManifest());
		expect(decoded.providers[0]).toMatchObject({
			slug: "fixture-provider",
			operations: { details: "fixture.details" },
		});
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
			{ ...manifest, providers: [{ ...provider, operations: { details: "fixture.automation" } }] },
		];
		return Effect.forEach(cases, (candidate) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(decodePluginManifest(candidate));
				assert(Exit.isFailure(exit));
				const failure = Cause.findErrorOption(exit.cause);
				assert(Option.isSome(failure));
				expect(failure.value._tag).toBe("PluginValidationError");
				expect(failure.value.issues.join("; ")).toContain(
					"Expected valid plugin config, provider, and script references",
				);
			}),
		);
	},
);
