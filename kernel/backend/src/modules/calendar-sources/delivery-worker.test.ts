import { describe, expect, it } from "vitest";

import { calendarDeliveryBounds } from "./delivery-worker";

const now = new Date("2026-10-29T02:30:00.000Z");

describe("calendar delivery bounds", () => {
	it("covers the recipient's local day and two catch-up days for dated releases", () => {
		expect(
			calendarDeliveryBounds({ now, timeZone: "UTC", precision: "date", maxAgeHours: null }),
		).toEqual({
			confirmedAfter: null,
			end: "2026-10-30T00:00:00.000Z",
			start: "2026-10-27T00:00:00.000Z",
		});
		expect(
			calendarDeliveryBounds({
				now,
				maxAgeHours: 72,
				precision: "date",
				timeZone: "America/Los_Angeles",
			}),
		).toEqual({
			end: "2026-10-29T00:00:00.000Z",
			start: "2026-10-26T00:00:00.000Z",
			confirmedAfter: "2026-10-26T02:30:00.000Z",
		});
	});

	it("bounds instants by local midnight two days back and the current instant", () => {
		expect(
			calendarDeliveryBounds({
				now,
				maxAgeHours: null,
				precision: "instant",
				timeZone: "Asia/Kolkata",
			}),
		).toEqual({
			confirmedAfter: null,
			end: "2026-10-29T02:30:00.001Z",
			start: "2026-10-26T18:30:00.000Z",
		});
	});
});
