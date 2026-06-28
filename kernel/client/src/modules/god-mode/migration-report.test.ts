import { describe, expect, it } from "vitest";

import {
	formatMigrationReportElapsed,
	migrationReportLevelPresentation,
} from "#/modules/god-mode/migration-report";

describe("migration report presentation", () => {
	it("presents warning and information levels", () => {
		expect(migrationReportLevelPresentation("warning")).toEqual({
			label: "Warning",
			tone: "text-danger",
			icon: "circle-alert",
		});
		expect(migrationReportLevelPresentation("info")).toEqual({
			icon: "info",
			label: "Info",
			tone: "text-info",
		});
	});

	it("formats optional elapsed seconds", () => {
		expect(formatMigrationReportElapsed(null)).toBe("-");
		expect(formatMigrationReportElapsed(12.5)).toBe("12.5s");
	});
});
