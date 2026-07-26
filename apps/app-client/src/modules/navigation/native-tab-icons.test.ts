import { describe, expect, it } from "vitest";

import {
	getAndroidNativeTabIconPath,
	getIosNativeTabIcon,
	getNativeTabIcon,
} from "./native-tab-icons";

describe("native tab icons", () => {
	it("maps a known app icon to native platform icons", () => {
		expect(getNativeTabIcon("clapperboard")).toEqual({
			ios: "movieclapper",
			android: "@expo/material-symbols/movie.xml",
		});
		expect(getIosNativeTabIcon("clapperboard")).toBe("movieclapper");
		expect(getAndroidNativeTabIconPath("clapperboard")).toBe("@expo/material-symbols/movie.xml");
	});

	it("uses circle icons for an unknown app icon", () => {
		expect(getNativeTabIcon("unknown")).toEqual({
			ios: "circle",
			android: "@expo/material-symbols/circle.xml",
		});
		expect(getIosNativeTabIcon("unknown")).toBe("circle");
		expect(getAndroidNativeTabIconPath("unknown")).toBe("@expo/material-symbols/circle.xml");
	});
});
