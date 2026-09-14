import { describe, expect, it } from "~/support/effect-test";

import { benchmarkSlugSegment } from "./workload-plugin";

const MANIFEST_SLUG_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

describe("benchmarkSlugSegment", () => {
	it("turns a UTC run id into a usable plugin manifest slug", () => {
		const slug = `sandbox-resource-baseline-${benchmarkSlugSegment("2026-09-13T20-18-02Z")}`;
		expect(slug).toMatch(MANIFEST_SLUG_PATTERN);
		expect(`book.${slug}.details`).toMatch(MANIFEST_SLUG_PATTERN);
	});

	it("collapses runs of unsupported characters without leaving separators at the edges", () => {
		expect(benchmarkSlugSegment("::Run__2026//09::")).toBe("run-2026-09");
	});
});
