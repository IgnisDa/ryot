import { expect, it } from "vitest";

import { deviceReportingTimeZone } from "./reporting-time-zone";

it("uses a device named zone and falls back to UTC when it is unavailable", () => {
	expect(deviceReportingTimeZone(() => "Asia/Kolkata")).toBe("Asia/Kolkata");
	expect(deviceReportingTimeZone(() => undefined)).toBe("UTC");
	expect(deviceReportingTimeZone(() => "+05:30")).toBe("UTC");
	expect(
		deviceReportingTimeZone(() => {
			throw new Error("unavailable");
		}),
	).toBe("UTC");
});
