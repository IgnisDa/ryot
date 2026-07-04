import { describe, expect, it } from "vitest";

import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/show/query-result-fixture";
import {
	decodeShowSummary,
	decodeShowSummaryResult,
	showSummaryRow,
} from "../../tests/client/show/summary-fixture";
import {
	mapShowSummary,
	showBackdropAsset,
	showCollectionsLabel,
	showEpisodeCountLabel,
	showEpisodeFact,
	showGalleryAssets,
	showLifecycleLabel,
	showManagedAssets,
	showOwnershipLabel,
	showPosterAsset,
	showRatingLabel,
	showReleaseLabel,
	showSeasonCountLabel,
	showSeasonFact,
	showSummaryError,
	showSummaryUnavailable,
} from "./summary-state";

const label = (items: readonly { id: string; name: string }[], hasMore = false) =>
	showCollectionsLabel(
		decodeShowSummary({ collections: { items, pageInfo: { hasMore, limit: 6 } } }).collections,
	);

describe("show summary state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapShowSummary(pendingQueryResult())).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		expect(mapShowSummary(malformedQueryResult()).status).toBe("malformed");
		expect(mapShowSummary(transportErrorQueryResult()).status).toBe("transport-error");
	});

	it("maps an absent entity to the missing unavailable reason", () => {
		const value = decodeShowSummaryResult({ show: [], requested: [] });

		expect(mapShowSummary(readyQueryResult(value))).toEqual({
			reason: "missing",
			status: "unavailable",
		});
	});

	it("maps a non-show entity to the unsupported unavailable reason", () => {
		const value = decodeShowSummaryResult({ show: [], requested: [{ schemaSlug: "book" }] });

		expect(mapShowSummary(readyQueryResult(value))).toEqual({
			reason: "unsupported",
			status: "unavailable",
		});
	});

	it("maps a decoded show to the ready state", () => {
		const value = decodeShowSummaryResult({
			show: [showSummaryRow],
			requested: [{ schemaSlug: "show" }],
		});

		expect(mapShowSummary(readyQueryResult(value))).toMatchObject({
			status: "ready",
			show: { id: "show-1", name: "Adolescence" },
		});
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(showSummaryError({ status: "malformed" })).toEqual({
			title: "Unable to display this show",
			detail: "This show returned data that could not be displayed. Try again later.",
		});
		expect(showSummaryError({ status: "transport-error" }).detail).not.toContain("RyotQL");
		expect(showSummaryUnavailable("missing").title).toBe("Show unavailable");
		expect(showSummaryUnavailable("unsupported").title).toBe("Show unavailable");
	});

	it("prefers the cover image over provider order for the poster", () => {
		const show = decodeShowSummary();

		expect(showPosterAsset(show)).toEqual({ type: "remote", url: "https://images.test/cover.jpg" });
		expect(showBackdropAsset(show)).toEqual({
			type: "remote",
			url: "https://images.test/backdrop.jpg",
		});
	});

	it("keeps provider order among images sharing a purpose", () => {
		const show = decodeShowSummary({
			images: [
				{ type: "remote", purpose: "cover", url: "https://images.test/cover-a.jpg" },
				{ type: "remote", purpose: "cover", url: "https://images.test/cover-b.jpg" },
			],
		});

		expect(showPosterAsset(show)).toEqual({
			type: "remote",
			url: "https://images.test/cover-a.jpg",
		});
		expect(showBackdropAsset(show)).toBeUndefined();
	});

	it("falls back to provider order when no image records a cover purpose", () => {
		const show = decodeShowSummary({
			images: [
				{ type: "remote", purpose: "still", url: "https://images.test/still.jpg" },
				{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
			],
		});

		expect(showPosterAsset(show)).toEqual({ type: "remote", url: "https://images.test/still.jpg" });
		expect(showBackdropAsset(show)).toEqual({
			type: "remote",
			url: "https://images.test/backdrop.jpg",
		});
	});

	it("collects the managed locators the poster, backdrop and gallery render", () => {
		const show = decodeShowSummary({
			images: [
				{ type: "s3", key: "cover-key", purpose: "cover" },
				{ type: "s3", key: "backdrop-key", purpose: "backdrop" },
				{ type: "s3", key: "still-key", purpose: "still" },
			],
		});

		expect(showManagedAssets(show)).toEqual([
			{ type: "s3", key: "backdrop-key" },
			{ type: "s3", key: "cover-key" },
			{ type: "s3", key: "still-key" },
		]);
	});

	it("keeps gallery assets in provider order and bounds the preview", () => {
		const show = decodeShowSummary({
			images: Array.from({ length: 12 }, (_, index) => ({
				type: "remote",
				purpose: "still",
				url: `https://images.test/still-${index}.jpg`,
			})),
		});

		expect(showGalleryAssets(show)).toHaveLength(10);
		expect(showGalleryAssets(show).at(0)).toEqual({
			type: "remote",
			url: "https://images.test/still-0.jpg",
		});
		expect(showGalleryAssets(decodeShowSummary({ images: null }))).toEqual([]);
	});

	it("resolves every managed image, not just the ones the preview shows", () => {
		const show = decodeShowSummary({
			images: Array.from({ length: 12 }, (_, index) => ({
				type: "s3",
				purpose: "still",
				key: `still-${index}`,
			})),
		});

		expect(showManagedAssets(show)).toHaveLength(12);
	});

	it("falls back to no poster when images are missing or empty", () => {
		expect(showPosterAsset(decodeShowSummary({ images: null }))).toBeUndefined();
		expect(showPosterAsset(decodeShowSummary({ images: [] }))).toBeUndefined();
		expect(showBackdropAsset(decodeShowSummary({ images: null }))).toBeUndefined();
		expect(showManagedAssets(decodeShowSummary({ images: null }))).toEqual([]);
	});

	it("prefers the publish year and falls back to the publish date", () => {
		expect(showReleaseLabel(decodeShowSummary())).toBe("2025");
		expect(showReleaseLabel(decodeShowSummary({ publishYear: null }))).toBe("2025-03-13");
		expect(
			showReleaseLabel(decodeShowSummary({ publishYear: null, publishDate: null })),
		).toBeUndefined();
	});

	it("omits counts and ratings that the provider did not record", () => {
		const sparse = decodeShowSummary({
			totalSeasons: null,
			totalEpisodes: null,
			providerRating: null,
		});

		expect(showRatingLabel(sparse)).toBeUndefined();
		expect(showSeasonFact(sparse)).toBeUndefined();
		expect(showEpisodeFact(sparse)).toBeUndefined();
		expect(showSeasonCountLabel(sparse)).toBeUndefined();
		expect(showEpisodeCountLabel(sparse)).toBeUndefined();
	});

	it("pluralizes recorded season and episode counts", () => {
		const show = decodeShowSummary({ totalSeasons: 1, totalEpisodes: 4 });

		expect(showSeasonCountLabel(show)).toBe("1 season");
		expect(showEpisodeCountLabel(show)).toBe("4 episodes");
		expect(showRatingLabel(show, "en-US")).toBe("78.25");
	});

	it("splits counts into a bare value and a pluralized fact label", () => {
		const single = decodeShowSummary({ totalSeasons: 1, totalEpisodes: 1 });
		const many = decodeShowSummary({ totalSeasons: 6, totalEpisodes: 71 });

		expect(showSeasonFact(single)).toEqual({ value: "1", label: "Season" });
		expect(showEpisodeFact(single)).toEqual({ value: "1", label: "Episode" });
		expect(showSeasonFact(many)).toEqual({ value: "6", label: "Seasons" });
		expect(showEpisodeFact(many)).toEqual({ value: "71", label: "Episodes" });
	});

	it("labels every media lifecycle state and ownership value", () => {
		expect(showLifecycleLabel("untracked")).toBe("Not tracked");
		expect(showLifecycleLabel("backlog")).toBe("In backlog");
		expect(showLifecycleLabel("in_progress")).toBe("In progress");
		expect(showLifecycleLabel("on_hold")).toBe("On hold");
		expect(showLifecycleLabel("dropped")).toBe("Dropped");
		expect(showLifecycleLabel("caught_up")).toBe("Caught up");
		expect(showLifecycleLabel("complete")).toBe("Complete");
		expect(showOwnershipLabel(null)).toBe("Not recorded");
		expect(showOwnershipLabel(true)).toBe("Owned");
		expect(showOwnershipLabel(false)).toBe("Not owned");
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
