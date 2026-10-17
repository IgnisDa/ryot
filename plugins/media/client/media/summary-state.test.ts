import { describe, expect, it } from "vitest";

import { decodeShowSummary } from "../../tests/client/show/summary-fixture";
import {
	mediaBackdropAsset,
	mediaCollectionsLabel,
	mediaEpisodicAiredLabel,
	mediaGalleryAssets,
	mediaManagedAssets,
	mediaOwnershipLabel,
	mediaPosterAsset,
	mediaRatingFact,
	mediaRatingLabel,
	mediaReleaseLabel,
	mediaSummaryHeaderDetail,
} from "./summary-state";

const label = (items: readonly { id: string; name: string }[], hasMore = false) =>
	mediaCollectionsLabel(
		decodeShowSummary({ collections: { items, pageInfo: { hasMore, limit: 6 } } }).collections,
	);

describe("media summary state", () => {
	it("maps genre names to chips and marks a truncated genre list", () => {
		const detail = mediaSummaryHeaderDetail({
			facts: () => [],
			logActivity: {
				family: "show",
				copy: { noun: "show", verb: "watch", gerund: "watching", participle: "watched" },
			},
		});

		expect(detail(decodeShowSummary()).chips).toEqual(["Crime", "Drama"]);
		expect(
			detail(
				decodeShowSummary({
					genres: {
						pageInfo: { limit: 100, hasMore: true },
						items: [{ name: "Crime", id: "genre-crime" }],
					},
				}),
			).chips,
		).toEqual(["Crime", "More genres"]);
	});

	it("words episode progress over the aired set and drops empty parts", () => {
		expect(mediaEpisodicAiredLabel({ aired: 10, watched: 10, upcoming: 3 })).toBe(
			"10/10 aired · 3 upcoming",
		);
		expect(mediaEpisodicAiredLabel({ aired: 10, watched: 4, upcoming: 0 })).toBe("4/10 aired");
		expect(mediaEpisodicAiredLabel({ aired: 0, watched: 0, upcoming: 2 })).toBe("2 upcoming");
		expect(mediaEpisodicAiredLabel({ aired: 0, watched: 0, upcoming: 0 })).toBeUndefined();
	});

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

	it("registers each managed locator once across image purposes and excludes remote images", () => {
		const media = decodeShowSummary({
			images: [
				{ type: "s3", key: "cover-key", purpose: "cover" },
				{ type: "s3", key: "artwork-key", purpose: "artwork" },
				{ type: "s3", key: "cover-key", purpose: "backdrop" },
				{ type: "local", key: "cover-key", purpose: "profile" },
				{ type: "local", purpose: "logo", key: "cover-key" },
				{ type: "remote", purpose: "screenshot", url: "https://images.test/game.jpg" },
			],
		});

		expect(mediaManagedAssets(media)).toEqual([
			{ type: "local", key: "cover-key" },
			{ type: "s3", key: "artwork-key" },
			{ type: "s3", key: "cover-key" },
		]);
	});

	it("collects all managed image locators", () => {
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

	it("resolves and deduplicates every managed image beyond the gallery preview", () => {
		const media = decodeShowSummary({
			images: [
				...Array.from({ length: 12 }, (_, index) => ({
					type: "s3",
					purpose: "still",
					key: `still-${String(index).padStart(2, "0")}`,
				})),
				{ type: "s3", key: "still-11", purpose: "artwork" },
				{ type: "s3", key: "still-00", purpose: "cover" },
			],
		});

		expect(mediaGalleryAssets(media)).toHaveLength(10);
		expect(mediaManagedAssets(media)).toEqual(
			Array.from({ length: 12 }, (_, index) => ({
				type: "s3",
				key: `still-${String(index).padStart(2, "0")}`,
			})),
		);
	});

	it("falls back to no poster when images are missing or empty", () => {
		expect(mediaPosterAsset(decodeShowSummary({ images: null }))).toBeUndefined();
		expect(mediaPosterAsset(decodeShowSummary({ images: [] }))).toBeUndefined();
		expect(mediaBackdropAsset(decodeShowSummary({ images: null }))).toBeUndefined();
		expect(mediaManagedAssets(decodeShowSummary({ images: null }))).toEqual([]);
		expect(mediaManagedAssets(decodeShowSummary({ images: [] }))).toEqual([]);
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
