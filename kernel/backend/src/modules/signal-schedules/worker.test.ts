import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { describe, expect, it } from "vitest";

import { signalScheduleBounds } from "./worker";

const now = new Date("2026-10-29T02:30:00.000Z");

describe("signal schedule bounds", () => {
	it("covers the recipient's local day and two catch-up days for dates", () => {
		expect(
			signalScheduleBounds({
				now,
				delayDays: null,
				precision: "date",
				maxAgeHours: null,
				timeZone: TimeZone.make("UTC"),
			}),
		).toEqual({
			confirmedAfter: null,
			end: "2026-10-30T00:00:00.000Z",
			start: "2026-10-27T00:00:00.000Z",
		});
		expect(
			signalScheduleBounds({
				now,
				delayDays: null,
				maxAgeHours: 72,
				precision: "date",
				timeZone: TimeZone.make("America/Los_Angeles"),
			}),
		).toEqual({
			end: "2026-10-29T00:00:00.000Z",
			start: "2026-10-26T00:00:00.000Z",
			confirmedAfter: "2026-10-26T02:30:00.000Z",
		});
	});

	it("bounds instants by local midnight two days back and the current instant", () => {
		expect(
			signalScheduleBounds({
				now,
				delayDays: null,
				maxAgeHours: null,
				precision: "instant",
				timeZone: TimeZone.make("Asia/Kolkata"),
			}),
		).toEqual({
			confirmedAfter: null,
			end: "2026-10-29T02:30:00.001Z",
			start: "2026-10-26T18:30:00.000Z",
		});
	});

	it("shifts the window back by the declared delay", () => {
		expect(
			signalScheduleBounds({
				now,
				delayDays: 7,
				maxAgeHours: null,
				precision: "instant",
				timeZone: TimeZone.make("UTC"),
			}),
		).toEqual({
			confirmedAfter: null,
			end: "2026-10-22T02:30:00.001Z",
			start: "2026-10-20T00:00:00.000Z",
		});
	});
});
