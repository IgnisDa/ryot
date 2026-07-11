import { describe, expect, it } from "vitest";

import { mediaActivityDurationLabel, mediaActivityError } from "./activity-timeline";

describe("media activity timeline labels", () => {
	it("formats recorded durations without padding empty units", () => {
		expect([0, 59, 60, 66].map(mediaActivityDurationLabel)).toEqual(["0m", "59m", "1h", "1h 6m"]);
	});

	it("separates transport failures from malformed activity", () => {
		expect(mediaActivityError({ status: "transport-error" }).detail).toContain("your connection");
		expect(mediaActivityError({ status: "malformed" }).detail).toContain("could not be displayed");
	});
});
