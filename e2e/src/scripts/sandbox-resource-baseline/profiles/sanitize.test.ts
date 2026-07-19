import { describe, expect, it } from "~/support/effect-test";

import { assertSanitized, findSensitiveStrings } from "./sanitize";
import type { ProfilesSummary } from "./summary";

const realisticSummary: ProfilesSummary = {
	runId: "20260919T101500Z",
	generatedAtUtc: "2026-09-19T10:15:00.000Z",
	rawDeletion: { deleted: true, remainingEntries: 0, verifiedAtUtc: "2026-09-19T10:16:00.000Z" },
	profiles: [
		{
			attempt: 1,
			kind: "deno-cpu",
			workload: "ytm-search",
			profileId: "ytm-search-cpu-1",
			notes: ["2 CPU profiles combined"],
			cpu: {
				source: "deno-v8",
				sampleCount: 1_200,
				sampledDurationMs: 1_450.25,
				topSelfFrames: [
					{
						line: 12,
						selfMs: 40,
						share: 0.03,
						category: "script-module",
						functionName: "<redacted-name>",
					},
				],
				categories: [
					{ selfMs: 800, share: 0.62, category: "dependency:youtubei.js-17.0.0" },
					{ selfMs: 200, share: 0.15, category: "dependency:@effect/platform" },
					{ selfMs: 150, share: null, category: "idle" },
				],
				topStacks: [
					{
						selfMs: 90,
						share: 0.07,
						frames: [
							{ functionName: "parseResponse", category: "dependency:youtubei.js-17.0.0" },
							{ category: "runner", functionName: "(anonymous)" },
						],
					},
				],
			},
		},
	],
};

describe("findSensitiveStrings", () => {
	it("accepts a realistic sanitized summary", () => {
		expect(findSensitiveStrings(realisticSummary)).toEqual([]);
		expect(() => assertSanitized(realisticSummary)).not.toThrow();
	});

	it.each([
		["UUID", { notes: ["run 3f2b8c1e-9a4d-4e21-b7c3-0d5e6f7a8b9c"] }, "$.notes[0]: UUID"],
		["hex run", { name: "cache-0123456789abcdef01234567" }, "$.name: long hex run"],
		[
			"JWT",
			{ note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N" },
			"$.note: JWT-like token",
		],
		["email", { owner: "someone@example.com" }, "$.owner: email address"],
		[
			"URL",
			{ frames: [{ source: "https://music.youtube.com/youtubei/v1" }] },
			"$.frames[0].source: URL",
		],
		["bearer", { header: "Bearer abc" }, "$.header: bearer credential"],
		["long string", { note: "x".repeat(201) }, "$.note: string longer than 200"],
		["sensitive key", { accessToken: 1 }, "$.accessToken: sensitive key name"],
		["key content", { "https://leak.example": 1 }, "$.https://leak.example: key is a URL"],
		["external id", { externalId: "dQw4w9WgXcQ" }, "$.externalId: external video identifier"],
		[
			"unbounded array",
			{ rows: Array.from({ length: 201 }, () => 0) },
			"$.rows: array has 201 entries (max 200)",
		],
	])("reports a planted %s", (_label, value, finding) => {
		expect(findSensitiveStrings(value)).toContain(finding);
	});

	it("names only the offending paths when asserting", () => {
		const planted = {
			...realisticSummary,
			profiles: [
				{ ...realisticSummary.profiles[0], notes: ["see https://music.youtube.com/watch"] },
			],
		};

		expect(() => assertSanitized(planted)).toThrow("$.profiles[0].notes[0]: URL");
		expect(() => assertSanitized(planted)).not.toThrow("music.youtube.com");
	});
});
