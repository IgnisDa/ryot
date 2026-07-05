import { describe, expect, it } from "bun:test";

import { dayjs } from "@ryot/ts-utils/dayjs";

import { activityLabel, hexToRgba, timeAgo } from "./overview-utils";

describe("hexToRgba", () => {
	it("converts a red hex to rgba", () => {
		expect(hexToRgba("#ff0000", 1)).toBe("rgba(255, 0, 0, 1)");
	});

	it("converts a black hex to rgba", () => {
		expect(hexToRgba("#000000", 0)).toBe("rgba(0, 0, 0, 0)");
	});

	it("converts a white hex to rgba with fractional alpha", () => {
		expect(hexToRgba("#ffffff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
	});

	it("converts a mixed color hex to rgba", () => {
		expect(hexToRgba("#1a2b3c", 0.8)).toBe("rgba(26, 43, 60, 0.8)");
	});
});

describe("timeAgo", () => {
	it("shows minutes for times within the last hour", () => {
		const date = dayjs().subtract(5, "minute").toISOString();
		expect(timeAgo(date)).toBe("5m ago");
	});

	it("shows hours for times within the last day", () => {
		const date = dayjs().subtract(6, "hour").toISOString();
		expect(timeAgo(date)).toBe("6h ago");
	});

	it("shows days for times within the last week", () => {
		const date = dayjs().subtract(3, "day").toISOString();
		expect(timeAgo(date)).toBe("3d ago");
	});

	it("shows weeks for times more than 7 days ago", () => {
		const date = dayjs().subtract(2, "week").toISOString();
		expect(timeAgo(date)).toBe("2w ago");
	});
});

describe("activityLabel", () => {
	it('returns "Logged progress" for progress events', () => {
		expect(activityLabel("progress", null)).toBe("Logged progress");
	});

	it('returns "Added to queue" for backlog events', () => {
		expect(activityLabel("backlog", null)).toBe("Added to queue");
	});

	it('returns "Completed" for complete events', () => {
		expect(activityLabel("complete", null)).toBe("Completed");
	});

	it('returns "Rated X/10" for review events with a rating', () => {
		expect(activityLabel("review", 8)).toBe("Rated 8/10");
	});

	it('returns "Reviewed" for review events without a rating', () => {
		expect(activityLabel("review", null)).toBe("Reviewed");
	});

	it('returns "Updated" for unknown event types', () => {
		expect(activityLabel("custom-event", null)).toBe("Updated");
	});
});
