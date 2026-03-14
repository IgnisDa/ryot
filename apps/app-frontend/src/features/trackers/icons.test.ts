import { describe, expect, it } from "bun:test";
import { iconNames } from "lucide-react/dynamic.mjs";
import { getTrackerIconOption, trackerIconOptions } from "./icons";

describe("trackerIconOptions", () => {
	it("exposes all lucide icons", () => {
		const values = trackerIconOptions.map((option) => option.value);

		expect(values).toEqual(iconNames);
	});

	it("resolves known lucide icon values", () => {
		const option = getTrackerIconOption("book-open");

		expect(option?.label).toBe("Book Open");
	});

	it("does not resolve unknown icon values", () => {
		const option = getTrackerIconOption("🎯");

		expect(option).toBeUndefined();
	});
});
