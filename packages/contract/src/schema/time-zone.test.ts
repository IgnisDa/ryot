import { expect, it } from "bun:test";

import { deviceTimeZone } from "./time-zone";

it("uses a device named zone and falls back to UTC when it is unavailable", () => {
	expect(deviceTimeZone(() => "Asia/Kolkata")).toBe<unknown>("Asia/Kolkata");
	expect(deviceTimeZone(() => undefined)).toBe<unknown>("UTC");
	expect(deviceTimeZone(() => "+05:30")).toBe<unknown>("UTC");
	expect(
		deviceTimeZone(() => {
			throw new Error("unavailable");
		}),
	).toBe<unknown>("UTC");
});
