import { describe, expect, it } from "vitest";

import {
	mediaActivityCountFigure,
	mediaActivityDurationLabel,
	mediaActivityError,
	mediaActivityRowsView,
	mediaTrackLengthLabel,
} from "./activity-timeline";

const flatRows = { isWatching: () => false, isCompletion: () => false };

const row = (key: string, occurredAt: string) => ({
	key,
	occurredAt,
	type: "review",
	dateKey: occurredAt.slice(0, 10),
});

describe("media activity timeline labels", () => {
	it("formats recorded durations without padding empty units", () => {
		expect([0, 59, 60, 66].map(mediaActivityDurationLabel)).toEqual(["0m", "59m", "1h", "1h 6m"]);
	});

	it("formats track lengths as minutes and zero-padded seconds", () => {
		expect([0, 9, 59, 222, 3600, 3735].map(mediaTrackLengthLabel)).toEqual([
			"0:00",
			"0:09",
			"0:59",
			"3:42",
			"1:00:00",
			"1:02:15",
		]);
	});

	it("rounds a counted total and marks it as a floor when part of it is unknown", () => {
		expect(mediaActivityCountFigure({ missing: 0, total: 640.4 })).toBe("640");
		expect(mediaActivityCountFigure({ total: 640, missing: 1 })).toBe("640+");
	});

	it("separates transport failures from malformed activity", () => {
		expect(mediaActivityError({ status: "transport-error" }).detail).toContain("your connection");
		expect(mediaActivityError({ status: "malformed" }).detail).toContain("could not be displayed");
	});
});

describe("media activity rows view", () => {
	it("has no view when nothing was recorded", () => {
		expect(mediaActivityRowsView([], flatRows, false)).toBeUndefined();
	});

	it("orders rows newest first and spans them fully when nothing was cut off", () => {
		const older = row("older", "2024-02-01T12:00:00.000Z");
		const newer = row("newer", "2024-02-03T12:00:00.000Z");

		expect(mediaActivityRowsView([older, newer], flatRows, false)).toEqual({
			timeline: { layout: "flat", rows: [newer, older] },
			span: { days: 3, bound: "full", latest: newer.occurredAt, earliest: older.occurredAt },
		});
	});

	it("keeps only the latest instant when the loaded rows are partial", () => {
		const older = row("older", "2024-02-01T12:00:00.000Z");
		const newer = row("newer", "2024-02-03T12:00:00.000Z");

		expect(mediaActivityRowsView([older, newer], flatRows, true)?.span).toEqual({
			bound: "partial",
			latest: newer.occurredAt,
		});
	});
});
