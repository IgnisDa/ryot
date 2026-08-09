import { describe, expect, it } from "vitest";

import {
	mediaActivityDurationLabel,
	mediaActivityError,
	mediaTrackLengthLabel,
} from "./activity-timeline";

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

	it("separates transport failures from malformed activity", () => {
		expect(mediaActivityError({ status: "transport-error" }).detail).toContain("your connection");
		expect(mediaActivityError({ status: "malformed" }).detail).toContain("could not be displayed");
	});
});
