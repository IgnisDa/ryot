import { expect, it } from "@effect/vitest";
import type { PluginHttpRateLimit } from "@ryot/plugin-kit/manifest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { makePluginLoader } from "./loader";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const plugin = (slug: string, httpRateLimits: Array<PluginHttpRateLimit>): NormalizedPlugin => {
	const manifest = fixtureManifest();
	return {
		scripts: [],
		sourceHash: `${slug}-source`,
		manifest: {
			...manifest,
			scripts: [],
			savedViews: [],
			httpRateLimits,
			entitySchemas: [],
			signalSchemas: [],
			relationshipSchemas: [],
			metadata: { ...manifest.metadata, slug },
			bindings: {
				eventAutomations: [],
				entityAutomations: [],
				signalAutomations: [],
				schemaProviderLinks: [],
				relationshipAutomations: [],
			},
		},
	};
};

const declaration = {
	requests: 10,
	intervalMs: 1_000,
	key: "catalog.shared",
	origins: ["https://two.example.com", "https://one.example.com"],
} satisfies PluginHttpRateLimit;

it("accepts identical declarations across plugins and builds immutable lookups", () => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	const snapshot = loader.previewAll([
		plugin("first", [declaration]),
		plugin("second", [{ ...declaration, origins: [...declaration.origins].toReversed() }]),
	]);

	expect(snapshot.httpRateLimits.byKey[declaration.key]?.hash).toMatch(/^[a-f0-9]{64}$/);
	expect(snapshot.httpRateLimits.byKey[declaration.key]?.declaration).toEqual({
		requests: 10,
		intervalMs: 1_000,
		key: "catalog.shared",
		origins: ["https://one.example.com", "https://two.example.com"],
	});
	expect(snapshot.httpRateLimits.byOrigin["https://one.example.com"]).toBe(
		snapshot.httpRateLimits.byKey[declaration.key],
	);
	expect(Object.isFrozen(snapshot.httpRateLimits.byKey)).toBe(true);
	expect(Object.isFrozen(snapshot.httpRateLimits.byOrigin)).toBe(true);
});

it("rejects conflicting keys and origins across active plugins", () => {
	const cases = [
		{
			expected: /Conflicting HTTP rate limit key 'catalog\.shared'/,
			second: { ...declaration, requests: 11, origins: ["https://other.example.com"] },
		},
		{
			expected: /Conflicting HTTP rate limit origin 'https:\/\/one\.example\.com'/,
			second: { ...declaration, key: "catalog.other", origins: ["https://one.example.com"] },
		},
	];

	for (const { expected, second } of cases) {
		const loader = makePluginLoader(makeDefinitionRegistry());
		expect(() =>
			loader.previewAll([plugin("first", [declaration]), plugin("second", [second])]),
		).toThrow(expected);
	}
});
