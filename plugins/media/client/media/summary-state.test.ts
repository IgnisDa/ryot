import { describe, expect, it } from "vitest";

import { decodeShowSummary } from "../../tests/client/show/summary-fixture";
import {
	mediaBackdropAsset,
	mediaCollectionsLabel,
	mediaGalleryAssets,
	mediaManagedAssets,
	mediaOwnershipLabel,
	mediaPosterAsset,
	mediaRatingFact,
	mediaRatingLabel,
	mediaReleaseLabel,
} from "./summary-state";

const label = (items: readonly { id: string; name: string }[], hasMore = false) =>
	mediaCollectionsLabel(
		decodeShowSummary({ collections: { items, pageInfo: { hasMore, limit: 6 } } }).collections,
	);

describe("media summary state", () => {
	it("prefers the cover image over provider order for the poster", () => {
		const media = decodeShowSummary();

		expect(mediaPosterAsset(media)).toEqual({
			type: "remote",
			url: "https://images.test/cover.jpg",
		});
		expect(mediaBackdropAsset(media)).toEqual({
			type: "remote",
			url: "https://images.test/backdrop.jpg",
		});
	});

	it("keeps provider order among images sharing a purpose", () => {
		const media = decodeShowSummary({
			images: [
				{ type: "remote", purpose: "cover", url: "https://images.test/cover-a.jpg" },
				{ type: "remote", purpose: "cover", url: "https://images.test/cover-b.jpg" },
			],
		});

		expect(mediaPosterAsset(media)).toEqual({
			type: "remote",
			url: "https://images.test/cover-a.jpg",
		});
		expect(mediaBackdropAsset(media)).toBeUndefined();
	});

	it("falls back to provider order when no image records a cover purpose", () => {
		const media = decodeShowSummary({
			images: [
				{ type: "remote", purpose: "still", url: "https://images.test/still.jpg" },
				{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
			],
		});

		expect(mediaPosterAsset(media)).toEqual({
			type: "remote",
			url: "https://images.test/still.jpg",
		});
		expect(mediaBackdropAsset(media)).toEqual({
			type: "remote",
			url: "https://images.test/backdrop.jpg",
		});
	});

	it("takes the backdrop from the first declared purpose an image matches", () => {
		const artwork = { type: "remote", purpose: "artwork", url: "https://images.test/artwork.jpg" };
		const backdrop = {
			type: "remote",
			purpose: "backdrop",
			url: "https://images.test/backdrop.jpg",
		};
		const media = decodeShowSummary({ images: [backdrop, artwork] });

		expect(mediaBackdropAsset(media, ["artwork", "backdrop"])).toEqual({
			type: "remote",
			url: "https://images.test/artwork.jpg",
		});
		expect(
			mediaBackdropAsset(decodeShowSummary({ images: [backdrop] }), ["artwork", "backdrop"]),
		).toEqual({ type: "remote", url: "https://images.test/backdrop.jpg" });
		expect(mediaBackdropAsset(media, ["artwork"])).toEqual({
			type: "remote",
			url: "https://images.test/artwork.jpg",
		});
		expect(mediaBackdropAsset(media, ["still"])).toBeUndefined();
	});

	it("resolves the declared backdrop purpose alongside the poster and gallery", () => {
		const media = decodeShowSummary({
			images: [
				{ type: "s3", key: "cover-key", purpose: "cover" },
				{ type: "s3", key: "artwork-key", purpose: "artwork" },
			],
		});

		expect(mediaManagedAssets(media, ["artwork"])).toEqual([
			{ type: "s3", key: "artwork-key" },
			{ type: "s3", key: "cover-key" },
		]);
	});

	it("collects the managed locators the poster, backdrop and gallery render", () => {
		const media = decodeShowSummary({
			images: [
				{ type: "s3", key: "cover-key", purpose: "cover" },
				{ type: "s3", key: "backdrop-key", purpose: "backdrop" },
				{ type: "s3", key: "still-key", purpose: "still" },
			],
		});

		expect(mediaManagedAssets(media)).toEqual([
			{ type: "s3", key: "backdrop-key" },
			{ type: "s3", key: "cover-key" },
			{ type: "s3", key: "still-key" },
		]);
	});

	it("keeps gallery assets in provider order and bounds the preview", () => {
		const media = decodeShowSummary({
			images: Array.from({ length: 12 }, (_, index) => ({
				type: "remote",
				purpose: "still",
				url: `https://images.test/still-${index}.jpg`,
			})),
		});

		expect(mediaGalleryAssets(media)).toHaveLength(10);
		expect(mediaGalleryAssets(media).at(0)).toEqual({
			type: "remote",
			url: "https://images.test/still-0.jpg",
		});
		expect(mediaGalleryAssets(decodeShowSummary({ images: null }))).toEqual([]);
	});

	it("resolves every managed image, not just the ones the preview shows", () => {
		const media = decodeShowSummary({
			images: Array.from({ length: 12 }, (_, index) => ({
				type: "s3",
				purpose: "still",
				key: `still-${index}`,
			})),
		});

		expect(mediaManagedAssets(media)).toHaveLength(12);
	});

	it("falls back to no poster when images are missing or empty", () => {
		expect(mediaPosterAsset(decodeShowSummary({ images: null }))).toBeUndefined();
		expect(mediaPosterAsset(decodeShowSummary({ images: [] }))).toBeUndefined();
		expect(mediaBackdropAsset(decodeShowSummary({ images: null }))).toBeUndefined();
		expect(mediaManagedAssets(decodeShowSummary({ images: null }))).toEqual([]);
	});

	it("prefers the publish year and falls back to the publish date", () => {
		expect(mediaReleaseLabel(decodeShowSummary())).toBe("2025");
		expect(mediaReleaseLabel(decodeShowSummary({ publishYear: null }))).toBe("2025-03-13");
		expect(
			mediaReleaseLabel(decodeShowSummary({ publishYear: null, publishDate: null })),
		).toBeUndefined();
	});

	it("omits the rating fact the provider did not record", () => {
		expect(mediaRatingLabel(decodeShowSummary({ providerRating: null }))).toBeUndefined();
		expect(mediaRatingFact(decodeShowSummary({ providerRating: null }))).toBeUndefined();
		expect(mediaRatingLabel(decodeShowSummary(), "en-US")).toBe("78.25");
	});

	it("names the rating fact after the provider that supplied it", () => {
		expect(mediaRatingFact(decodeShowSummary())).toMatchObject({
			icon: "star",
			value: "78.25",
			suffix: " / 100",
			label: "TMDB rating",
		});
		expect(mediaRatingFact(decodeShowSummary({ providerName: null }))?.label).toBe(
			"Provider rating",
		);
	});

	it("labels ownership values that were never recorded apart from known ones", () => {
		expect(mediaOwnershipLabel(null)).toBe("Not recorded");
		expect(mediaOwnershipLabel(true)).toBe("Owned");
		expect(mediaOwnershipLabel(false)).toBe("Not owned");
	});

	it("labels collection membership by count and truncation", () => {
		expect(label([])).toBe("Not in any collection");
		expect(label([{ id: "c1", name: "Completed" }])).toBe("1 collection");
		expect(
			label([
				{ id: "c1", name: "Completed" },
				{ id: "c2", name: "Messed Up Order" },
			]),
		).toBe("2 collections");
		expect(label([{ id: "c1", name: "Completed" }], true)).toBe("1+ collections");
	});
});
