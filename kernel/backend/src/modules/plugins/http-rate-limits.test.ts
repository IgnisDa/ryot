import { expect, it } from "@effect/vitest";
import type { PluginHttpRateLimit } from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionKey,
	definitionOwner,
	identityTupleKey,
} from "@ryot-app/contract/modules/plugins/references";

import { buildHttpRateLimitLookups } from "./http-rate-limits";

const declaration = {
	requests: 10,
	intervalMs: 1_000,
	key: "catalog.shared",
	origins: ["https://two.example.com", "https://one.example.com"],
} satisfies PluginHttpRateLimit;

it("accepts identical declarations across plugins and builds canonical lookups", () => {
	const lookups = buildHttpRateLimitLookups([
		{
			scope: "system",
			slug: "whiskey",
			httpRateLimits: [declaration],
			owner: definitionOwner("first"),
		},
		{
			slug: "whiskey",
			scope: "system",
			owner: definitionOwner("second"),
			httpRateLimits: [{ ...declaration, origins: [...declaration.origins].toReversed() }],
		},
	]);

	const key = definitionKey("http-rate-limit", definitionOwner("first"), declaration.key);
	expect(lookups.byKey[key]?.hash).toMatch(/^[a-f0-9]{64}$/);
	expect(lookups.byKey[key]?.declaration).toEqual({
		requests: 10,
		intervalMs: 1_000,
		key: "catalog.shared",
		origins: ["https://one.example.com", "https://two.example.com"],
	});
	expect(lookups.byOrigin["https://one.example.com"]?.hash).toBe(lookups.byKey[key]?.hash);
	expect(Object.keys(lookups.byKey)).toHaveLength(2);
});

it("rejects conflicting keys within an owner and quotas at a shared origin", () => {
	const cases = [
		{
			ownerId: "first",
			expected: /Conflicting HTTP rate limit key 'catalog\.shared'/,
			second: { ...declaration, requests: 11, origins: ["https://other.example.com"] },
		},
		{
			ownerId: "second",
			expected: /Conflicting HTTP rate limit origin 'https:\/\/one\.example\.com'/,
			second: {
				...declaration,
				requests: 11,
				key: "catalog.other",
				origins: ["https://one.example.com"],
			},
		},
	];

	for (const { second, ownerId, expected } of cases) {
		expect(() =>
			buildHttpRateLimitLookups([
				{
					slug: "first",
					scope: "system",
					httpRateLimits: [declaration],
					owner: definitionOwner("first"),
				},
				{
					slug: "second",
					scope: "system",
					httpRateLimits: [second],
					owner: definitionOwner(ownerId),
				},
			]),
		).toThrow(expected);
	}
});

it("allows independent local labels while sharing compatible origin quotas", () => {
	const lookups = buildHttpRateLimitLookups([
		{
			scope: "system",
			slug: "whiskey",
			httpRateLimits: [declaration],
			owner: definitionOwner("first"),
		},
		{
			scope: "system",
			slug: "whiskey",
			owner: definitionOwner("second"),
			httpRateLimits: [{ ...declaration, key: "other", origins: ["https://one.example.com"] }],
		},
	]);
	expect(
		lookups.byKey[definitionKey("http-rate-limit", definitionOwner("first"), declaration.key)]
			?.hash,
	).toBe(lookups.byKey[definitionKey("http-rate-limit", definitionOwner("second"), "other")]?.hash);
	expect(lookups.byOrigin["https://one.example.com"]?.declaration.key).toBe(
		identityTupleKey("http-origin", "https://one.example.com"),
	);
	const firstOnly = buildHttpRateLimitLookups([
		{
			scope: "system",
			slug: "whiskey",
			httpRateLimits: [declaration],
			owner: definitionOwner("first"),
		},
	]);
	expect(lookups.byOrigin["https://one.example.com"]).toEqual(
		firstOnly.byOrigin["https://one.example.com"],
	);
	expect(() =>
		buildHttpRateLimitLookups([
			{
				scope: "user",
				slug: "whiskey",
				httpRateLimits: [declaration],
				owner: definitionOwner("private"),
			},
		]),
	).toThrow("Private plugins cannot declare deployment HTTP policies");
});
