import {
	mediaEpisodicCoveragePercent,
	type MediaEpisodicCoverage,
} from "../../../client/media/episodic-activity-state";
import { defineEpisodicMediaSchema } from "../../../client/media/episodic-schema";
import { MEDIA_ART_HEIGHT } from "../../../client/media/hero";
import { episodicFixtureRecipes, type EpisodicFixtureActivityResult } from "./recipes";

export const episodicFixtureCoverage = (
	result: EpisodicFixtureActivityResult,
): MediaEpisodicCoverage => {
	const [episodes] = result.coverage;
	if (episodes === undefined) {
		return {
			rows: [],
			minutes: { total: 0, missing: 0 },
			headline: { watched: 0, total: undefined },
		};
	}
	return {
		headline: { total: episodes.episodeTotal, watched: episodes.watchedTotal },
		minutes: { total: episodes.watchedMinutes ?? 0, missing: episodes.watchedUnknownRuntime },
		rows: [
			{
				key: episodes.id,
				label: "Episodes",
				total: episodes.episodeTotal,
				watched: episodes.watchedTotal,
				percent: mediaEpisodicCoveragePercent(episodes.watchedTotal, episodes.episodeTotal),
			},
		],
	};
};

export const episodicFixtureSchema = defineEpisodicMediaSchema({
	facts: () => [],
	aspect: "square",
	typeLabel: "Fixture",
	EpisodesTab: () => null,
	presentationFacts: () => [],
	recipes: episodicFixtureRecipes,
	coverage: episodicFixtureCoverage,
	heroHeight: () => MEDIA_ART_HEIGHT,
	presentationDetail: () => undefined,
	overviewLoadingDetail: "Fetching the credits for this item.",
	nouns: { plural: "items", title: "Fixture", singular: "item" },
	creditCopy: { people: "People", notice: "Credits", companies: "Companies" },
	episodeOrigin: (episode: { readonly episodeNumber: number }) => `Ep ${episode.episodeNumber}`,
	activityCopy: {
		segmentNoun: "Pass",
		recordLabel: "Item record",
		loadingDetail: "Fetching the item record.",
		emptyDetail: "Nothing has been recorded for this item.",
		figures: { time: "Time", watches: "Passes", episodes: "Episodes" },
		rowLabels: { watched: "Heard", review: "Reviewed the item", completion: "Finished the item" },
		beats: {
			backlog: "Added to backlog",
			dropped: "Stopped the item",
			on_hold: "Put this item on hold",
		},
	},
});
