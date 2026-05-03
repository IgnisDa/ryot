import { describe, expect, it } from "vitest";

import {
	decodeImportRunList,
	failedRunRow,
	preparingRunRow,
	runningRunRow,
} from "./import-fixture";
import {
	canDeleteImportRun,
	humanizeImportSourceSlug,
	importRunCountsLabel,
	importRunDeleteConfirmation,
	importRunFailureNotice,
	importRunOutcomeLabel,
	importRunProgress,
	importRunProgressValue,
	importRunProvenanceLabel,
	importSourceName,
	liveImportRun,
} from "./run-presentation";

const runs = decodeImportRunList({
	runs: [runningRunRow, preparingRunRow, failedRunRow],
}).items;
const [running, preparing, failed] = runs;
const completed = decodeImportRunList().items[0];

describe("import run presentation", () => {
	it("treats only finished runs as deletable", () => {
		expect((["pending", "running"] as const).map(canDeleteImportRun)).toEqual([false, false]);
		expect((["completed", "failed"] as const).map(canDeleteImportRun)).toEqual([true, true]);
	});

	it("keeps an unknown total off the progress track instead of inventing a percentage", () => {
		expect(importRunProgress(preparing)).toEqual({ kind: "indeterminate", label: "Preparing" });
		expect(importRunProgressValue(preparing)).toEqual({ text: "0 read so far" });
	});

	it("reads out progress against the known total", () => {
		expect(importRunProgress(running)).toEqual({ kind: "determinate", label: "34%", percent: 34 });
		expect(importRunProgressValue(running)).toEqual({
			min: 0,
			now: 412,
			max: 1204,
			text: "412 of 1,204",
		});
	});

	it("spells out the counts a reader is watching", () => {
		expect(importRunCountsLabel(running)).toBe("412 of 1,204 read · 396 added · 16 failed");
		expect(importRunCountsLabel(preparing)).toBe("0 read · 0 added · 0 failed");
	});

	it("summarises an outcome, and rewrites the error for a failed run", () => {
		expect(importRunOutcomeLabel(completed)).toBe("2,014 added · 31 failed");
		expect(importRunOutcomeLabel({ ...completed, failedItems: 0 })).toBe("2,014 added");
		expect(importRunOutcomeLabel(failed)).toBe("Ran out of time");
		expect(importRunOutcomeLabel(failed)).not.toContain("ETIMEDOUT");
	});

	it("rewrites known failure summaries and falls back to a stable sentence", () => {
		expect(importRunFailureNotice("Upload was malformed").label).toBe("File unreadable");
		expect(importRunFailureNotice("401 unauthorized").label).toBe("Access refused");
		expect(importRunFailureNotice("connection reset").label).toBe("Source unreachable");
		expect(importRunFailureNotice(null)).toEqual({
			label: "Stopped early",
			detail: "This import stopped before it finished. Nothing further was added.",
		});
	});

	it("names a source from the manifest and humanises an unknown slug", () => {
		const names = new Map([["open_scale", "OpenScale"]]);
		expect(importSourceName("open_scale", names)).toBe("OpenScale");
		expect(importSourceName("strong_app", names)).toBe("Strong App");
		expect(humanizeImportSourceSlug("goodreads")).toBe("Goodreads");
	});

	it("credits the uploaded file when one was recorded", () => {
		expect(importRunProvenanceLabel(completed.inputSummary)).toBe(
			"From goodreads_library_export.csv",
		);
		expect(importRunProvenanceLabel(running.inputSummary)).toBeUndefined();
		expect(importRunProvenanceLabel({ fileNames: [1, "a.csv"] })).toBe("From a.csv");
	});

	it("finds the run still in flight", () => {
		expect(liveImportRun(runs)?.id).toBe(running.id);
		expect(liveImportRun([completed, failed])).toBeUndefined();
	});

	it("corrects the belief that deleting a record removes what was imported", () => {
		expect(importRunDeleteConfirmation(completed)).toBe(
			"This removes the record and its list of 31 failures. The 2,014 items it added stay in your library.",
		);
		expect(importRunDeleteConfirmation({ ...completed, failedItems: 1, importedItems: 1 })).toBe(
			"This removes the record and its list of 1 failure. The 1 item it added stays in your library.",
		);
		expect(importRunDeleteConfirmation(failed)).toBe(
			"This removes the record of this import. Nothing it added is affected.",
		);
	});
});
