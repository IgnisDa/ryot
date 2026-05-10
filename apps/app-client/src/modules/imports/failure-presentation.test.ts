import { describe, expect, it } from "vitest";

import {
	buildImportFailureClipboardText,
	groupImportFailuresByStage,
	importFailureContextEntries,
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

	it("lays out recorded context as sorted key-value pairs", () => {
		expect(importFailureContextEntries(unreadable.context)).toEqual([
			{ key: "column", value: "My Rating" },
			{ key: "rawValue", value: "four stars" },
		]);
		expect(importFailureContextEntries(null)).toEqual([]);
		expect(importFailureContextEntries({ a: null, b: 4, c: { d: 1 } })).toEqual([
			{ key: "a", value: "—" },
			{ key: "b", value: "4" },
			{ key: "c", value: '{"d":1}' },
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
		expect(text).toContain("- Item #11: No provider match was found");
		expect(text).toContain("- The Long Way Home: The rating column was not a number");
		expect(text).toContain("    column: My Rating");
	});
});
