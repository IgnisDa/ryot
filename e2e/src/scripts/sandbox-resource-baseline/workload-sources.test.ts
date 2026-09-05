import { describe, expect, it } from "~/support/effect-test";

import {
	benchmarkBookDetailsSource,
	benchmarkScriptSource,
	decodeBenchmarkExternalId,
	deterministicPayload,
	encodeBenchmarkExternalId,
} from "./workload-sources";

const workload = {
	seed: 7,
	payloadBytes: 1024,
	perCallDelayMs: 25,
	durableHostCalls: 5,
	suggestionCount: 10,
	relatedEntityCount: 100,
	terminalOutcome: "typed-failure" as const,
};

describe("deterministicPayload", () => {
	it("produces the same bytes for the same seed and differs across seeds", () => {
		expect(deterministicPayload(42, 512)).toBe(deterministicPayload(42, 512));
		expect(deterministicPayload(42, 512)).not.toBe(deterministicPayload(43, 512));
	});

	it("returns exactly the requested number of single-byte printable characters", () => {
		const payload = deterministicPayload(1, 4096);
		expect(payload).toHaveLength(4096);
		expect(new TextEncoder().encode(payload)).toHaveLength(4096);
		expect(payload).toMatch(/^[A-Za-z0-9+/]+$/);
	});

	it("spreads across the alphabet so the payload is not compression friendly", () => {
		const payload = deterministicPayload(9, 8192);
		expect(new Set(payload).size).toBeGreaterThan(60);
	});
});

describe("benchmark external id", () => {
	it("round-trips every workload knob", () => {
		const encoded = encodeBenchmarkExternalId({ ...workload, nonce: "run-1-2" });
		expect(decodeBenchmarkExternalId(encoded)).toEqual({ ...workload, nonce: "run-1-2" });
	});

	it("rejects identifiers that are not benchmark workloads", () => {
		expect(decodeBenchmarkExternalId("e2e-book-1")).toBeNull();
		expect(decodeBenchmarkExternalId("bm.1.0.0.0.1024.0.unknown.nonce")).toBeNull();
		expect(decodeBenchmarkExternalId("bm.1.0.0.0.1024.0.success")).toBeNull();
	});
});

describe("generated sandbox sources", () => {
	it("embeds one payload generator so the host and sandbox cannot drift", () => {
		const source = benchmarkScriptSource({ name: "Bench", slug: "bench.script" });
		expect(source).toContain(deterministicPayload.toString());
	});

	it("wires the configured relationship slugs into the details provider", () => {
		const source = benchmarkBookDetailsSource({
			name: "Bench details",
			slug: "book.bench.details",
			bookProviderSlug: "book.bench",
			personProviderSlug: "person.bench",
			suggestionRelationshipSlug: "media-suggestion",
			relatedEntityRelationshipSlug: "person-to-book",
		});
		expect(source).toContain('"media-suggestion"');
		expect(source).toContain('"person-to-book"');
		expect(source).toContain(decodeBenchmarkExternalId.toString());
	});
});
