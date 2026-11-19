import { describe, expect, it } from "bun:test";

import { testFormatters } from "@ryot-app/kernel-messages/testing";

import { testMediaText } from "../../tests/client/test-text";
import {
	mediaActivityCountFigure,
	mediaActivityError,
	mediaActivityRowsView,
} from "./activity-timeline";

const flatRows = { isWatching: () => false, isCompletion: () => false };

const row = (key: string, occurredAt: string) => ({
	key,
	occurredAt,
	type: "review",
	dateKey: occurredAt.slice(0, 10),
});

describe("media activity timeline labels", () => {
	it("rounds a counted total and marks it as a floor when part of it is unknown", () => {
		expect(mediaActivityCountFigure(testFormatters, { missing: 0, total: 640.4 })).toBe("640");
		expect(mediaActivityCountFigure(testFormatters, { total: 640, missing: 1 })).toBe("640+");
	});

	it("separates transport failures from malformed activity", () => {
		expect(mediaActivityError(testMediaText, { status: "transport-error" }).detail).toContain(
			"your connection",
		);
		expect(mediaActivityError(testMediaText, { status: "malformed" }).detail).toContain(
			"could not be displayed",
		);
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
