import { describe, expect, it } from "vitest";

import { deriveImageTint, getImageTintGradientStops, quantizeImageTintPixels } from "./image-tint";

describe("image tint", () => {
	it("prefers the dark muted color when both are usable", () => {
		expect(deriveImageTint({ darkMuted: "#369", dominant: "#F00" })).toBe("#395E84");
		expect(deriveImageTint({ darkMuted: "#963", dominant: "#00F" })).toBe("#845E39");
	});

	it("uses the dominant color when dark muted is unusable", () => {
		expect(deriveImageTint({ dominant: "#00FF00", darkMuted: "not-a-color" })).toBe("#398439");
		expect(deriveImageTint({ darkMuted: undefined, dominant: "#123456" })).toBe("#294560");
	});

	it("caps saturation, clamps lightness, and expands short hex colors", () => {
		expect(deriveImageTint({ dominant: "#F00" })).toBe("#843939");
		expect(deriveImageTint({ dominant: "#000001" })).toBe("#292960");
	});

	it("returns undefined when no candidate color is valid", () => {
		expect(deriveImageTint({ dominant: "transparent", darkMuted: "not-a-color" })).toBeUndefined();
		expect(deriveImageTint({ dominant: "#12345678" })).toBeUndefined();
		expect(deriveImageTint({})).toBeUndefined();
	});

	it("generates the three gradient alpha stops", () => {
		expect(getImageTintGradientStops("#3d668f")).toEqual(["#3D668F52", "#3D668F1F", "#3D668F00"]);
		expect(getImageTintGradientStops("#369")).toEqual(["#33669952", "#3366991F", "#33669900"]);
		expect(getImageTintGradientStops("#33669980")).toBeUndefined();
	});
});

const solidPixel = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

const buffer = (pixels: ReadonlyArray<ReadonlyArray<number>>) =>
	new Uint8ClampedArray(pixels.flat());

describe("quantizeImageTintPixels", () => {
	it("reports a solid color as both dominant and dark muted when it qualifies", () => {
		const pixels = buffer(Array.from({ length: 4 }, () => solidPixel(90, 60, 40)));

		expect(quantizeImageTintPixels(pixels)).toEqual({ dominant: "#5A3C28", darkMuted: "#5A3C28" });
	});

	it("keeps the dominant and dark muted buckets distinct when the dominant color is too bright", () => {
		const pixels = buffer([
			...Array.from({ length: 5 }, () => solidPixel(255, 255, 255)),
			...Array.from({ length: 3 }, () => solidPixel(80, 50, 30)),
		]);

		const result = quantizeImageTintPixels(pixels);
		expect(result.dominant).toBe("#FFFFFF");
		expect(result.darkMuted).toBe("#50321E");
	});

	it("ignores fully transparent pixels", () => {
		const pixels = buffer([
			...Array.from({ length: 3 }, () => solidPixel(10, 10, 10, 0)),
			solidPixel(200, 30, 30),
		]);

		expect(quantizeImageTintPixels(pixels)).toEqual({ dominant: "#C81E1E" });
	});

	it("returns nothing for an empty or fully-transparent buffer", () => {
		expect(quantizeImageTintPixels(new Uint8ClampedArray([]))).toEqual({});
		expect(quantizeImageTintPixels(buffer([solidPixel(10, 10, 10, 0)]))).toEqual({});
	});
});
