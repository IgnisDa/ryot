import { describe, expect, it } from "vitest";

import { makeIntegrationSummary } from "./integration-fixture";
import {
	integrationDeleteConfirmation,
	integrationProviderName,
	integrationStateLabel,
	integrationSyncLabel,
	integrationTitle,
} from "./integration-presentation";

const names = new Map([["media:komga", "Komga"]]);

const nowMs = Date.parse("2026-08-23T12:00:00.000Z");

describe("integration presentation", () => {
	it("falls back to the provider name when unnamed or blank", () => {
		expect(integrationTitle(makeIntegrationSummary({ name: null }), names)).toBe("Komga");
		expect(integrationTitle(makeIntegrationSummary({ name: "   " }), names)).toBe("Komga");
		expect(integrationTitle(makeIntegrationSummary({ name: "Shelf" }), names)).toBe("Shelf");
	});

	it("falls back to the provider slug when the plugin is unknown", () => {
		expect(integrationProviderName(makeIntegrationSummary(), new Map())).toBe("komga");
		expect(integrationProviderName(makeIntegrationSummary(), names)).toBe("Komga");
	});

	it("distinguishes a never-synced integration from a synced one", () => {
		expect(integrationSyncLabel(makeIntegrationSummary({ lastFinishedAt: null }), nowMs)).toBe(
			"Never synced",
		);
		expect(
			integrationSyncLabel(
				makeIntegrationSummary({ lastFinishedAt: "2026-08-23T11:00:00.000Z" }),
				nowMs,
			),
		).toBe("Synced 1 hour ago");
	});

	it("names the paused state plainly", () => {
		expect(integrationStateLabel(makeIntegrationSummary({ isDisabled: true }))).toBe("Paused");
		expect(integrationStateLabel(makeIntegrationSummary({ isDisabled: false }))).toBe("Active");
	});

	it("says what deleting keeps and what it removes", () => {
		expect(integrationDeleteConfirmation(makeIntegrationSummary({ name: "Shelf" }), names)).toBe(
			"Shelf will stop syncing and its settings will be removed. Anything it already brought into your library stays.",
		);
	});
});
