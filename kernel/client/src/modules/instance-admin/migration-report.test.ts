import type { MigrationReportDetail } from "@ryot-app/contract/modules/instance-admin/migration-report";
import { describe, expect, it } from "vitest";

import {
	buildMigrationReportClipboardText,
	formatMigrationReportElapsed,
	migrationReportDetailProvenance,
	migrationReportLevelPresentation,
} from "#/modules/instance-admin/migration-report";

const skippedRecord = {
	key: "rec_1",
	label: "Record one",
	sentence: "There was nothing to attach this record to.",
	provenance: [
		{ key: "Title", value: "Record one" },
		{ value: null, key: "Original value" },
		{ value: "", key: "Note" },
		{ key: "User", value: "usr_1" },
	],
} as const satisfies MigrationReportDetail;

describe("migration report presentation", () => {
	it("presents warning and information levels", () => {
		expect(migrationReportLevelPresentation("warning")).toEqual({
			label: "Warning",
			tone: "text-warning",
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

	it("omits provenance entries that carry no value", () => {
		expect(migrationReportDetailProvenance(skippedRecord)).toEqual([
			{ key: "Title", value: "Record one" },
			{ key: "User", value: "usr_1" },
		]);
	});

	it("builds shareable text that notes details beyond the served page", () => {
		expect(
			buildMigrationReportClipboardText({
				totalDetails: 3,
				code: "record-skipped",
				details: [skippedRecord],
				phase: "records -> event",
				message: "Some records were not carried over.",
			}),
		).toBe(
			[
				"Ryot migration report — records -> event",
				"Code: record-skipped",
				"Some records were not carried over.",
				"",
				"- Record one: There was nothing to attach this record to.",
				"    Title: Record one",
				"    User: usr_1",
				"",
				"...and 2 more not listed here.",
			].join("\n"),
		);
	});
});
