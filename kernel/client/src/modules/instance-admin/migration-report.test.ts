import { describe, expect, it } from "bun:test";

import type { MigrationReportDetail } from "@ryot-app/contract/modules/instance-admin/migration-report";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { testFormatters, testKernelText } from "@ryot-app/kernel-messages/testing";

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
			tone: "text-warning",
			icon: "circle-alert",
			label: kernelMessage("client.instance-admin.migration-report.level.warning"),
		});
		expect(migrationReportLevelPresentation("info")).toEqual({
			icon: "info",
			tone: "text-info",
			label: kernelMessage("client.instance-admin.migration-report.level.info"),
		});
	});

	it("formats optional elapsed seconds", () => {
		expect(formatMigrationReportElapsed(testFormatters, null)).toBe("-");
		expect(formatMigrationReportElapsed(testFormatters, 12.5)).toBe("12.5s");
	});

	it("omits provenance entries that carry no value", () => {
		expect(migrationReportDetailProvenance(skippedRecord)).toEqual([
			{ key: "Title", value: "Record one" },
			{ key: "User", value: "usr_1" },
		]);
	});

	it("builds shareable text that notes details beyond the served page", () => {
		expect(
			buildMigrationReportClipboardText(testKernelText, {
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
				"…and 2 more not listed here.",
			].join("\n"),
		);
	});
});
