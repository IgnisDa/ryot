import { describe, expect, it } from "vitest";

import type { MediaImage } from "../shared/media-image";
import {
	galleryFilterImages,
	galleryFilters,
	galleryImages,
	galleryStep,
	galleryTileAspect,
	galleryTileColumns,
	galleryTileFit,
} from "./image-gallery-state";

const remote = (url: string, purpose?: MediaImage["purpose"]): MediaImage =>
	purpose === undefined ? { url, type: "remote" } : { url, purpose, type: "remote" };

const mixed = [
	remote("https://images.test/one.jpg", "backdrop"),
	remote("https://images.test/two.jpg", "cover"),
	remote("https://images.test/three.jpg", "backdrop"),
	remote("https://images.test/four.jpg"),
];

describe("image gallery state", () => {
	it("keeps the purpose that the asset mapper drops", () => {
		expect(galleryImages(mixed).map((image) => image.purpose)).toEqual([
			"backdrop",
			"cover",
			"backdrop",
			undefined,
		]);
	});

	it("builds filters in schema order with all first and untagged images under other", () => {
		expect(galleryFilters(galleryImages(mixed))).toEqual([
			{ count: 4, label: "All", filter: "all" },
			{ count: 1, filter: "cover", label: "Covers" },
			{ count: 2, filter: "backdrop", label: "Backdrops" },
			{ count: 1, label: "Other", filter: "other" },
		]);
	});

	it("hides the filter row when the images span fewer than two groups", () => {
		const single = galleryImages([
			remote("https://images.test/one.jpg", "backdrop"),
			remote("https://images.test/two.jpg", "backdrop"),
		]);

		expect(galleryFilters(single)).toEqual([]);
		expect(galleryFilters([])).toEqual([]);
	});

	it("narrows to one purpose and treats untagged images as other", () => {
		const images = galleryImages(mixed);

		expect(galleryFilterImages(images, "all")).toHaveLength(4);
		expect(galleryFilterImages(images, "backdrop")).toHaveLength(2);
		expect(galleryFilterImages(images, "other")).toEqual([
			{ type: "remote", purpose: undefined, url: "https://images.test/four.jpg" },
		]);
	});

	it("letterboxes mixed shapes and fills a single purpose", () => {
		expect(galleryTileFit("all")).toBe("contain");
		expect(galleryTileFit("cover")).toBe("cover");
		expect(galleryTileAspect("all")).toBe("aspect-3/2");
		expect(galleryTileAspect("cover")).toBe("aspect-2/3");
		expect(galleryTileAspect("backdrop")).toBe("aspect-video");
		expect(galleryTileAspect("logo")).toBe("aspect-5/2");
	});

	it("packs tall tiles more densely and phones less densely", () => {
		expect(galleryTileColumns("all", false)).toBe("grid-cols-4");
		expect(galleryTileColumns("cover", false)).toBe("grid-cols-6");
		expect(galleryTileColumns("all", true)).toBe("grid-cols-2");
		expect(galleryTileColumns("cover", true)).toBe("grid-cols-3");
	});

	it("stops stepping at both ends", () => {
		expect(galleryStep(0, 3, 1)).toBe(1);
		expect(galleryStep(0, 3, -1)).toBe(0);
		expect(galleryStep(2, 3, 1)).toBe(2);
		expect(galleryStep(2, 3, -1)).toBe(1);
	});
});
