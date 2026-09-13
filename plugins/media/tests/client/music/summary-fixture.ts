import { Result } from "@ryot-app/client-sdk/effect";

import { musicSummaryRecipe } from "../../../shared/music-recipes";
import { rowsResult } from "../query-result-fixture";

export const musicSummaryFixtureRecipe = musicSummaryRecipe({
	collectionLimit: 6,
	entityId: "music-1",
});

export const musicSummaryRow = {
	owned: null,
	duration: 222,
	id: "music-1",
	publishYear: 1997,
	state: "complete",
	isInLibrary: true,
	isMonitored: false,
	schemaSlug: "music",
	providerRating: 92.5,
	progressPercent: null,
	byVariousArtists: false,
	name: "Paranoid Android",
	populationStatus: "ready",
	translationStatus: "none",
	publishDate: "1997-05-26",
	providerName: "MusicBrainz",
	productionStatus: "Released",
	genres: ["Alternative Rock", "Art Rock"],
	description: "The second single from OK Computer.",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/ok-computer.jpg" }],
	collections: {
		pageInfo: { limit: 6, hasMore: false },
		items: [{ name: "Completed", id: "collection-1" }],
	},
};

const singleRow = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

export const decodeMusicSummaryResult = (input: {
	readonly music: readonly Record<string, unknown>[];
	readonly requested: readonly Record<string, unknown>[];
}) =>
	Result.getOrThrow(
		musicSummaryFixtureRecipe.decode({
			data: { music: singleRow(input.music), requested: singleRow(input.requested) },
		}),
	);

export const decodeMusicSummary = (overrides: Record<string, unknown> = {}) => {
	const summary = decodeMusicSummaryResult({
		requested: [{ schemaSlug: "music" }],
		music: [{ ...musicSummaryRow, ...overrides }],
	});
	if (summary.music === null) {
		throw new Error("Expected a decoded music summary");
	}
	return summary.music;
};
