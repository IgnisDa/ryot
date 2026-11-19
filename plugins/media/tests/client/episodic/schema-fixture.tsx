import { Text } from "@ryot-app/i18n/text";

import {
	type MediaEpisodicCoverage,
	mediaEpisodicCoveragePercent,
} from "../../../client/media/episodic-activity-state";
import { defineEpisodicMediaSchema } from "../../../client/media/episodic-schema";
import { catalogMessage } from "../../../shared/messages.generated";
import { type EpisodicFixtureActivityResult, episodicFixtureRecipes } from "./recipes";

export const episodicFixtureCoverage = (
	result: EpisodicFixtureActivityResult,
): MediaEpisodicCoverage => {
	const [episodes] = result.coverage;
	if (episodes === undefined) {
		return { rows: [], headline: { watched: 0, total: undefined } };
	}
	return {
		headline: { total: episodes.episodeTotal, watched: episodes.watchedTotal },
		rows: [
			{
				key: episodes.id,
				total: episodes.episodeTotal,
				watched: episodes.watchedTotal,
				label: catalogMessage("property.episodes"),
				percent: mediaEpisodicCoveragePercent(episodes.watchedTotal, episodes.episodeTotal),
			},
		],
	};
};

export const episodicFixtureSchema = defineEpisodicMediaSchema({
	facts: () => [],
	aspect: "square",
	EpisodesTab: () => null,
	presentationFacts: () => [],
	recipes: episodicFixtureRecipes,
	coverage: episodicFixtureCoverage,
	presentationDetail: () => undefined,
	overviewLoadingDetail: catalogMessage("overview.loading.show"),
	logActivity: { family: "show", copy: { verb: "watch", kind: "movie" } },
	episodeOrder: (episode: { readonly episodeNumber: number }) => [episode.episodeNumber],
	episodeOrigin: (episode: { readonly episodeNumber: number }) =>
		catalogMessage("home.episode-position", { episode: episode.episodeNumber }),
	creditCopy: {
		people: catalogMessage("credits.people"),
		notice: catalogMessage("credits.notice"),
		companies: catalogMessage("credits.companies"),
	},
	activityCopy: () => ({
		segment: "watch" as const,
		recordLabel: "Item record",
		libraryLabel: "Added to media library",
		loadingDetail: Text("Fetching the item record."),
		emptyDetail: Text("Nothing has been recorded for this item."),
		figures: { time: "Time", watches: "Passes", current: "This pass", episodes: "Episodes" },
		beats: { on_hold: "Put on hold", backlog: "Added to backlog", dropped: "Stopped the item" },
		rowLabels: {
			watched: "played" as const,
			review: "Reviewed the item",
			completion: "Finished the item",
		},
	}),
});
