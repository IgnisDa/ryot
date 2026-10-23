import { describe, expect, it } from "@effect/vitest";
import type { SyncStatus } from "@ryot-app/plugin-ui-sdk/sync";

import { mediaSyncCounts } from "./sync-counts";

const item = (populationStatus: SyncStatus, translationStatus: SyncStatus = "none") => ({
	populationStatus,
	translationStatus,
});

describe("mediaSyncCounts", () => {
	it("counts artless pending items as populating and leaves failed items out", () => {
		expect(
			mediaSyncCounts(
				[item("pending"), item("failed"), item("failed"), item("ready", "pending")],
				() => undefined,
			),
		).toEqual({ populating: 1, translating: 1 });
	});
});
