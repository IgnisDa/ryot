import { describe, expect, it } from "bun:test";

import { testFormatters } from "@ryot-app/kernel-messages/testing";

import { decodeShowSummary } from "../../tests/client/show/summary-fixture";
import { testMediaCopy, testMediaText } from "../../tests/client/test-text";
import {
	mediaCollectionsLabel,
	mediaEpisodicAiredLabel,
	mediaGalleryPreview,
	mediaRatingFact,
	mediaRatingLabel,
	mediaReleaseLabel,
	mediaSummaryHeaderDetail,
} from "./summary-state";

const label = (items: readonly { id: string; name: string }[], hasMore = false) =>
	mediaCollectionsLabel(
		testMediaCopy,
		decodeShowSummary({ collections: { items, pageInfo: { hasMore, limit: 6 } } }).collections,
	);

describe("media summary state", () => {
	it("maps genre names to chips and marks a truncated genre list", () => {
		const detail = mediaSummaryHeaderDetail({
			facts: () => [],
			logActivity: { family: "show", copy: { kind: "show", verb: "watch" } },
		});

		expect(detail(decodeShowSummary(), testMediaCopy).chips).toEqual(["Crime", "Drama"]);
		expect(
			detail(
				decodeShowSummary({
					genres: {
						pageInfo: { limit: 100, hasMore: true },
						items: [{ name: "Crime", id: "genre-crime" }],
					},
				}),
				testMediaCopy,
			).chips,
		).toEqual(["Crime", "More genres"]);
	});

	it("words episode progress over the aired set and drops empty parts", () => {
		expect<string | undefined>(
			mediaEpisodicAiredLabel(testMediaText, { aired: 10, watched: 10, upcoming: 3 }),
		).toBe("10 of 10 complete · 3 upcoming");
		expect<string | undefined>(
			mediaEpisodicAiredLabel(testMediaText, { aired: 10, watched: 4, upcoming: 0 }),
		).toBe("4 of 10 complete");
		expect<string | undefined>(
			mediaEpisodicAiredLabel(testMediaText, { aired: 0, watched: 0, upcoming: 2 }),
		).toBe("2 upcoming");
		expect<string | undefined>(
			mediaEpisodicAiredLabel(testMediaText, { aired: 0, watched: 0, upcoming: 0 }),
		).toBeUndefined();
	});

	it("uses the bounded preview and deduplicates a repeated backdrop", () => {
		expect(mediaGalleryPreview(decodeShowSummary()).map((image) => image.purpose)).toEqual([
			"backdrop",
			"cover",
		]);
	});

	it("holds canonical poster thumbnails while localized artwork is pending", () => {
		const media = decodeShowSummary({
			translationStatus: { state: "idle", availability: "missing" },
		});
		expect(mediaGalleryPreview(media).map((image) => image.purpose)).toEqual(["backdrop"]);
		expect(
			mediaGalleryPreview({
				...media,
				translationStatus: { state: "failed", availability: "missing" },
			}),
		).toHaveLength(2);
		const localized = {
			type: "remote",
			purpose: "cover",
			url: "https://images.test/localized.jpg",
		} as const;
		expect(
			mediaGalleryPreview({
				...media,
				image: localized,
				translationStatus: { state: "succeeded", availability: "complete" },
			}),
		).toMatchObject([{ purpose: "backdrop" }, localized]);
	});

	it("prefers the publish year and falls back to the publish date", () => {
		expect(mediaReleaseLabel(decodeShowSummary())).toBe("2025");
		expect(mediaReleaseLabel(decodeShowSummary({ publishYear: null }))).toBe("2025-03-13");
		expect(
			mediaReleaseLabel(decodeShowSummary({ publishYear: null, publishDate: null })),
		).toBeUndefined();
	});

	it("omits the rating fact the provider did not record", () => {
		expect(
			mediaRatingLabel(testFormatters, decodeShowSummary({ providerRating: null })),
		).toBeUndefined();
		expect(
			mediaRatingFact(testMediaCopy, decodeShowSummary({ providerRating: null })),
		).toBeUndefined();
		expect(mediaRatingLabel(testFormatters, decodeShowSummary())).toBe("78.25");
	});

	it("names the rating fact after the provider that supplied it", () => {
		expect(mediaRatingFact(testMediaCopy, decodeShowSummary())).toMatchObject({
			icon: "star",
			value: "78.25",
			suffix: " / 100",
			label: "TMDB rating",
		});
		expect<string | undefined>(
			mediaRatingFact(testMediaCopy, decodeShowSummary({ providerName: null }))?.label,
		).toBe("Provider rating");
	});

	it("labels collection membership by count and truncation", () => {
		expect<string>(label([])).toBe("Add to collection");
		expect<string>(label([{ id: "c1", name: "Completed" }])).toBe("1 collection");
		expect<string>(
			label([
				{ id: "c1", name: "Completed" },
				{ id: "c2", name: "Messed Up Order" },
			]),
		).toBe("2 collections");
		expect<string>(label([{ id: "c1", name: "Completed" }], true)).toBe("1+ collections");
	});
});
