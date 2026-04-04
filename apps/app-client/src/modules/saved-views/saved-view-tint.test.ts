import { describe, expect, it } from "vitest";

import {
	SAVED_VIEW_COLOR_FALLBACK,
	deriveSavedViewTint,
	getSavedViewTintGradientStops,
} from "./saved-view-tint";

describe("saved-view tint", () => {
	it("prefers dark muted colors on Android and web", () => {
		expect(deriveSavedViewTint({ platform: "android", darkMuted: "#369", dominant: "#F00" })).toBe(
			"#395E84",
		);
		expect(deriveSavedViewTint({ platform: "web", darkMuted: "#963", dominant: "#00F" })).toBe(
			"#845E39",
		);
	});

	it("uses the dominant color when dark muted is unusable", () => {
		expect(
			deriveSavedViewTint({
				platform: "android",
				dominant: "#00FF00",
				darkMuted: SAVED_VIEW_COLOR_FALLBACK,
			}),
		).toBe("#398439");
		expect(
			deriveSavedViewTint({ platform: "web", darkMuted: "not-a-color", dominant: "#123456" }),
		).toBe("#294560");
	});

	it("uses the iOS background color", () => {
		expect(deriveSavedViewTint({ platform: "ios", background: "#FFFFFF" })).toBe("#5E5E5E");
	});

	it("caps saturation, clamps lightness, and expands short hex colors", () => {
		expect(deriveSavedViewTint({ platform: "ios", background: "#F00" })).toBe("#843939");
		expect(deriveSavedViewTint({ platform: "ios", background: "#000001" })).toBe("#292960");
	});

	it("returns undefined when no selected color is valid", () => {
		expect(
			deriveSavedViewTint({
				platform: "android",
				dominant: "transparent",
				darkMuted: SAVED_VIEW_COLOR_FALLBACK,
			}),
		).toBeUndefined();
		expect(deriveSavedViewTint({ platform: "ios", background: "#12345678" })).toBeUndefined();
	});

	it("generates the three gradient alpha stops", () => {
		expect(getSavedViewTintGradientStops("#3d668f")).toEqual([
			"#3D668F52",
			"#3D668F1F",
			"#3D668F00",
		]);
		expect(getSavedViewTintGradientStops("#369")).toEqual(["#33669952", "#3366991F", "#33669900"]);
		expect(getSavedViewTintGradientStops("#33669980")).toBeUndefined();
	});
});
