import { expect, it } from "@effect/vitest";
import type { PluginHttpRateLimit } from "@ryot-app/contract/modules/plugins/manifest";

import { buildHttpRateLimitLookups } from "./http-rate-limits";

const declaration = {
	requests: 10,
	intervalMs: 1_000,
	key: "catalog.shared",
	origins: ["https://two.example.com", "https://one.example.com"],
} satisfies PluginHttpRateLimit;

it("accepts identical declarations across plugins and builds canonical lookups", () => {
	const lookups = buildHttpRateLimitLookups([
		{ slug: "first", httpRateLimits: [declaration] },
		{
			slug: "second",
			httpRateLimits: [{ ...declaration, origins: [...declaration.origins].toReversed() }],
		},
	]);

	expect(lookups.byKey[declaration.key]?.hash).toMatch(/^[a-f0-9]{64}$/);
	expect(lookups.byKey[declaration.key]?.declaration).toEqual({
		requests: 10,
		intervalMs: 1_000,
		key: "catalog.shared",
		origins: ["https://one.example.com", "https://two.example.com"],
	});
	expect(lookups.byOrigin["https://one.example.com"]).toBe(lookups.byKey[declaration.key]);
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

	for (const { second, expected } of cases) {
		expect(() =>
			buildHttpRateLimitLookups([
				{ slug: "first", httpRateLimits: [declaration] },
				{ slug: "second", httpRateLimits: [second] },
			]),
		).toThrow(expected);
	}
});
