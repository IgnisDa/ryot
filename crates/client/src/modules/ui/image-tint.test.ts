import { describe, expect, it } from "vitest";

import {
	IMAGE_TINT_COLOR_FALLBACK,
	deriveImageTint,
	getImageTintGradientStops,
} from "./image-tint";

describe("image tint", () => {
	it("prefers dark muted colors on Android and web", () => {
		expect(deriveImageTint({ platform: "android", darkMuted: "#369", dominant: "#F00" })).toBe(
			"#395E84",
		);
		expect(deriveImageTint({ platform: "web", darkMuted: "#963", dominant: "#00F" })).toBe(
			"#845E39",
		);
	});

	it("uses the dominant color when dark muted is unusable", () => {
		expect(
			deriveImageTint({
				platform: "android",
				dominant: "#00FF00",
				darkMuted: IMAGE_TINT_COLOR_FALLBACK,
			}),
		).toBe("#398439");
		expect(
			deriveImageTint({ platform: "web", darkMuted: "not-a-color", dominant: "#123456" }),
		).toBe("#294560");
	});

	it("uses the iOS background color", () => {
		expect(deriveImageTint({ platform: "ios", background: "#FFFFFF" })).toBe("#5E5E5E");
	});

	it("caps saturation, clamps lightness, and expands short hex colors", () => {
		expect(deriveImageTint({ platform: "ios", background: "#F00" })).toBe("#843939");
		expect(deriveImageTint({ platform: "ios", background: "#000001" })).toBe("#292960");
	});

	it("returns undefined when no selected color is valid", () => {
		expect(
			deriveImageTint({
				platform: "android",
				dominant: "transparent",
				darkMuted: IMAGE_TINT_COLOR_FALLBACK,
			}),
		).toBeUndefined();
		expect(deriveImageTint({ platform: "ios", background: "#12345678" })).toBeUndefined();
	});

	it("generates the three gradient alpha stops", () => {
		expect(getImageTintGradientStops("#3d668f")).toEqual(["#3D668F52", "#3D668F1F", "#3D668F00"]);
		expect(getImageTintGradientStops("#369")).toEqual(["#33669952", "#3366991F", "#33669900"]);
		expect(getImageTintGradientStops("#33669980")).toBeUndefined();
	});
});
