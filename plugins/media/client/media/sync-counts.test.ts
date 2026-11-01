import { describe, expect, it } from "@effect/vitest";
import type { EnrichmentState } from "@ryot-app/plugin-client-sdk";

import { mediaSyncCounts } from "./sync-counts";

const item = (
	population: EnrichmentState["state"],
	translation: EnrichmentState["state"] = "idle",
) => ({
	populationStatus: { state: population, availability: "missing" } satisfies EnrichmentState,
	translationStatus: { state: translation, availability: "missing" } satisfies EnrichmentState,
});

describe("mediaSyncCounts", () => {
	it("counts artless pending items as populating and leaves failed items out", () => {
		expect(
			mediaSyncCounts(
				[item("queued"), item("failed"), item("idle"), item("succeeded", "retrying")],
				() => undefined,
			),
		).toEqual({ populating: 1, translating: 1 });
	});
});
