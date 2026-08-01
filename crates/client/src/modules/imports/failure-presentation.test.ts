import { describe, expect, it } from "vitest";

import {
	buildImportFailureClipboardText,
	groupImportFailuresByStage,
	importFailureProvenanceEntries,
	importFailureReasonDetail,
	importFailureRowLabel,
	importFailureStageHeading,
	importFailureStagePill,
} from "./failure-presentation";
import { decodeImportRunDetail } from "./import-fixture";

const failures = decodeImportRunDetail().failures.items;
const [unreadable, unmatched] = failures;

describe("import failure presentation", () => {
	it("gives every stage a heading and a short pill instead of its raw name", () => {
		const stages = [
			"event_policy",
			"source_fetch",
			"database_commit",
			"provider_details",
			"provider_resolution",
			"input_transformation",
		] as const;

		expect(stages.map(importFailureStageHeading)).toEqual([
			"Blocked by one of your rules",
			"Source unavailable",
			"Couldn't be saved",
			"Details unavailable",
			"Couldn't be matched",
			"Couldn't be read",
		]);
		expect(stages.map(importFailureStagePill)).toEqual([
			"Blocked",
			"Unreachable",
			"Not saved",
			"No details",
			"Not matched",
			"Not read",
		]);
	});

	it("identifies a row by label, then identifier, then position", () => {
		expect(importFailureRowLabel(unreadable)).toBe("The Long Way Home");
		expect(importFailureRowLabel({ ...unreadable, sourceLabel: "  " })).toBe("goodreads:8231");
		expect(importFailureRowLabel(unmatched)).toBe("Item #11");
	});

	it("groups failures under their stage in a stable order", () => {
		const groups = groupImportFailuresByStage(failures);

		expect(groups.map((group) => group.heading)).toEqual([
			"Couldn't be read",
			"Couldn't be matched",
		]);
		expect(groups.map((group) => group.failures.length)).toEqual([1, 1]);
		expect(groupImportFailuresByStage([])).toEqual([]);
	});

	it("presents safe reasons and typed provenance", () => {
		expect(importFailureReasonDetail(unreadable)).toBe("The source data could not be read.");
		expect(importFailureProvenanceEntries(unreadable)).toEqual([
			{ key: "Source ID", value: "goodreads:8231" },
		]);
		expect(importFailureProvenanceEntries(unmatched)).toEqual([
			{ key: "Entity schema", value: "book" },
		]);
	});

	it("writes the whole failure set out as support-ready text", () => {
		const text = buildImportFailureClipboardText({
			failures,
			sourceName: "OpenScale",
			runId: "run-completed-1",
		});

		expect(text.split("\n").slice(0, 4)).toEqual([
			"Ryot import failures",
			"Source: OpenScale",
			"Run: run-completed-1",
			"Failures listed: 2",
		]);
		expect(text).toContain("- Item #11: No matching provider item was found.");
		expect(text).toContain("- The Long Way Home: The source data could not be read.");
		expect(text).toContain("    Source ID: goodreads:8231");
	});
});
