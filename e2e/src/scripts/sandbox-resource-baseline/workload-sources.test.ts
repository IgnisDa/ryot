import { describe, expect, it } from "~/support/effect-test";

import {
	benchmarkBookDetailsSource,
	benchmarkScriptSource,
	DECODE_EXTERNAL_ID_SOURCE,
	DETERMINISTIC_PAYLOAD_SOURCE,
	decodeBenchmarkExternalId,
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
	it("annotates the embedded helpers because the sandbox compiler forbids implicit any", () => {
		expect(DETERMINISTIC_PAYLOAD_SOURCE).toContain(
			"function deterministicPayload(seed: number, byteLength: number): string",
		);
		expect(DECODE_EXTERNAL_ID_SOURCE).toContain(
			"function decodeBenchmarkExternalId(value: string): BenchmarkWorkload | null",
		);
		expect(DECODE_EXTERNAL_ID_SOURCE).toContain("(part: string)");
		expect(DECODE_EXTERNAL_ID_SOURCE).toContain("(part: number)");
	});

	it("embeds the payload generator in the scripts that return a payload", () => {
		expect(benchmarkScriptSource({ name: "Bench", slug: "bench.script" })).toContain(
			DETERMINISTIC_PAYLOAD_SOURCE,
		);
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
		expect(source).toContain(DECODE_EXTERNAL_ID_SOURCE);
		expect(source).toContain(DETERMINISTIC_PAYLOAD_SOURCE);
	});
});
