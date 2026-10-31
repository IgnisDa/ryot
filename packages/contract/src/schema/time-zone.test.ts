import { expect, it } from "vitest";

import { deviceTimeZone } from "./time-zone";

it("uses a device named zone and falls back to UTC when it is unavailable", () => {
	expect(deviceTimeZone(() => "Asia/Kolkata")).toBe("Asia/Kolkata");
	expect(deviceTimeZone(() => undefined)).toBe("UTC");
	expect(deviceTimeZone(() => "+05:30")).toBe("UTC");
	expect(
		deviceTimeZone(() => {
			throw new Error("unavailable");
		}),
	).toBe("UTC");
});
