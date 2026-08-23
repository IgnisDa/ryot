import { Result } from "@ryot-app/client-sdk/effect";

import { podcastRecipes } from "../../../shared/podcast-recipes";
import { rowsResult } from "../query-result-fixture";

const rows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const podcastSummaryFixtureRecipe = podcastRecipes.summaryRecipe({
	collectionLimit: 6,
	entityId: "podcast-1",
});

const podcastOverviewFixtureRecipe = podcastRecipes.overviewRecipe({
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "podcast-1",
	recommendationLimit: 12,
});

const podcastActivityFixtureRecipe = podcastRecipes.activityRecipe({
	timeZone: "UTC",
	coverageLimit: 100,
	watchDayLimit: 1000,
	parentEventLimit: 60,
	entityId: "podcast-1",
	episodeEventLimit: 100,
	collectionEventLimit: 60,
	episodeProgressLimit: 100,
});

export const podcastSummaryRow = {
	owned: null,
	id: "podcast-1",
	publishYear: 2014,
	name: "Reply All",
	totalEpisodes: 412,
	isMonitored: false,
	storedEpisodes: 400,
	watchedEpisodes: 183,
	state: "in_progress",
	providerRating: 72.5,
	inProgressEpisodes: 1,
	schemaSlug: "podcast",
	isInMediaLibrary: true,
	genres: ["Technology"],
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Ended",
	publishDate: "2014-11-18",
	providerName: "Listen Notes",
	description: "A show about the internet.",
	collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/reply-all.jpg" }],
};

export const decodePodcastSummary = (overrides: Record<string, unknown> = {}) => {
	const decoded = Result.getOrThrow(
		podcastSummaryFixtureRecipe.decode({
			data: {
				requested: rows([{ schemaSlug: "podcast" }]),
				summary: rows([{ ...podcastSummaryRow, ...overrides }]),
			},
		}),
	);
	if (decoded.summary === null) {
		throw new Error("Expected a decoded podcast summary");
	}
	return decoded.summary;
};

export const decodePodcastOverview = (
	input: { readonly unlinkedCreators?: readonly Record<string, string>[] } = {},
) =>
	Result.getOrThrow(
		podcastOverviewFixtureRecipe.decode({
			data: {
				people: rows([]),
				companies: rows([]),
				recommendations: rows([]),
				creators: rows([
					{
						unlinkedCreators: input.unlinkedCreators ?? [
							{ role: "Artist", name: "PJ Vogt" },
							{ role: "Publisher", name: "Gimlet Media" },
						],
					},
				]),
			},
		}),
	);

export const podcastCoverageRow = {
	id: "podcast-1",
	episodeTotal: 400,
	watchedTotal: 183,
	watchedMinutes: 9150,
	watchedUnknownRuntime: 2,
};

export const decodePodcastActivity = (
	input: { readonly coverage?: readonly Record<string, unknown>[] } = {},
) =>
	Result.getOrThrow(
		podcastActivityFixtureRecipe.decode({
			data: {
				episodeEvents: rows([]),
				episodeProgress: rows([]),
				collectionEvents: rows([]),
				totals: rows([{ watchCount: 4 }]),
				coverage: rows(input.coverage ?? [podcastCoverageRow]),
				watchDays: { items: [], type: "aggregate", pageInfo: { limit: 1000, hasMore: false } },
				parentEvents: rows([
					{
						text: null,
						rating: null,
						timeSpent: null,
						startedOn: null,
						isSpoiler: null,
						consumedOn: null,
						completedOn: null,
						id: "podcast-complete",
						eventSchemaSlug: "complete",
						createdAt: "2025-11-06T12:00:05.000Z",
						occurredAt: "2025-11-06T12:00:00.000Z",
					},
				]),
			},
		}),
	);
