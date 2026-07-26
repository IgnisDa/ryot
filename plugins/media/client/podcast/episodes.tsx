import { createRyotQuery } from "@ryot-app/client-sdk/react";
import type { Recipe } from "@ryot-app/client-sdk/ryotql";
import clsx from "clsx";

import type { MediaSummaryOf } from "../../shared/media-recipes";
import type { podcastRecipes } from "../../shared/podcast-recipes";
import { podcastEpisodesRecipe } from "../../shared/podcast-recipes";
import { mediaCursorPageError, type MediaCursorPage } from "../media/cursor-page-state";
import {
	MediaEpisodePages,
	type MediaEpisodePageInput,
	type MediaEpisodePagesCopy,
	type MediaEpisodeRender,
} from "../media/episodes";
import { mediaEpisodeNumberLabel } from "../media/episodes-state";
import { mediaCountLabel } from "../media/summary-state";

export const PODCAST_EPISODE_PAGE_LIMIT = 40;

type PodcastSummary = MediaSummaryOf<typeof podcastRecipes>;

export type PodcastEpisode = Recipe.Success<typeof podcastEpisodesRecipe>["items"][number];

export const podcastEpisodeOriginLabel = (episode: { readonly episodeNumber: number }) =>
	`Ep ${episode.episodeNumber}`;

export const podcastEpisodesQuery = createRyotQuery<
	MediaEpisodePageInput,
	MediaCursorPage<PodcastEpisode>
>(
	({ input, client, signal }) =>
		client.data.query(
			podcastEpisodesRecipe({
				containerId: input.containerId,
				limit: PODCAST_EPISODE_PAGE_LIMIT,
				...(input.after === null ? {} : { after: input.after }),
			}),
			{ signal },
		),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.items.map(({ id }) => id) ?? [],
		}),
	},
);

const PODCAST_EPISODE_RENDER: MediaEpisodeRender<PodcastEpisode> = {
	aspect: "square",
	purpose: "cover",
	numberLabel: mediaEpisodeNumberLabel,
	originLabel: podcastEpisodeOriginLabel,
	stateLabels: { complete: "Played", untracked: undefined, in_progress: "In progress" },
};

const PODCAST_EPISODE_PAGES_COPY: MediaEpisodePagesCopy = {
	empty: "No episodes have been recorded for this podcast yet.",
	error: (state) => mediaCursorPageError({ state, noun: "episodes" }),
	loading: { title: "Loading episodes...", detail: "Fetching this podcast's episodes." },
};

export const podcastEpisodeCountLine = (summary: PodcastSummary | undefined) => {
	if (summary === undefined) {
		return undefined;
	}
	const total = summary.totalEpisodes ?? summary.storedEpisodes;
	if (total === 0) {
		return undefined;
	}
	const played = summary.watchedEpisodes === 0 ? undefined : `${summary.watchedEpisodes} played`;
	return [mediaCountLabel(total, "episode"), played]
		.filter((part) => part !== undefined)
		.join(" · ");
};

export function PodcastEpisodesTab(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly summary: PodcastSummary | undefined;
}) {
	const counts = podcastEpisodeCountLine(props.summary);
	return (
		<div className={clsx("flex flex-col", props.compact ? "gap-5 pt-6" : "gap-6 pt-8")}>
			{counts === undefined ? null : (
				<p className="font-ui text-[12px] text-text-subtle">{counts}</p>
			)}
			<MediaEpisodePages
				nextUp="latest"
				compact={props.compact}
				entityId={props.entityId}
				containerId={props.entityId}
				query={podcastEpisodesQuery}
				render={PODCAST_EPISODE_RENDER}
				copy={PODCAST_EPISODE_PAGES_COPY}
			/>
		</div>
	);
}
