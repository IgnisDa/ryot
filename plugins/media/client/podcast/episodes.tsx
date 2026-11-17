import clsx from "clsx";

import type { MediaSummaryOf } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import type { podcastRecipes } from "../../shared/podcast-recipes";
import { MediaChildCreateAction } from "../entity-editor/edit-action";
import type { MediaActivityLogger } from "../media/activity-log/state";
import { mediaCursorPageError } from "../media/cursor-page-state";
import {
	MediaEpisodePages,
	type MediaEpisodePagesCopy,
	type MediaEpisodeRender,
} from "../media/episodes";
import { mediaEpisodeNumberLabel } from "../media/episodes-state";
import { type MediaText, useMediaMessages } from "../messages";
import { type PodcastEpisode, podcastEpisodesQuery } from "./episodes-query";

type PodcastSummary = MediaSummaryOf<typeof podcastRecipes>;

export const podcastEpisodeOriginLabel = (episode: { readonly episodeNumber: number }) =>
	catalogMessage("home.episode-position", { episode: episode.episodeNumber });

const PODCAST_EPISODE_RENDER: MediaEpisodeRender<PodcastEpisode> = {
	aspect: "square",
	purpose: "cover",
	entitySchemaSlug: "podcast-episode",
	numberLabel: mediaEpisodeNumberLabel,
	originLabel: podcastEpisodeOriginLabel,
	stateLabels: {
		untracked: undefined,
		complete: catalogMessage("episodes.state-played"),
		in_progress: catalogMessage("browse.status.in-progress"),
	},
	activityEpisode: (episode) => ({
		id: episode.id,
		seasonNumber: null,
		name: episode.name,
		state: episode.state,
		episodeNumber: episode.episodeNumber,
	}),
};

const podcastEpisodePagesCopy = (text: MediaText): MediaEpisodePagesCopy => ({
	empty: text("podcast.episodes-empty"),
	error: (state) => mediaCursorPageError(text, { state, kind: "episodes" }),
	loading: { title: text("episodes.loading-title"), detail: text("podcast.episodes-loading") },
});

export const podcastEpisodeCountLine = (text: MediaText, summary: undefined | PodcastSummary) => {
	if (summary === undefined) {
		return undefined;
	}
	const total = summary.totalEpisodes ?? summary.airedEpisodes;
	if (total === 0) {
		return undefined;
	}
	const played =
		summary.watchedEpisodes === 0
			? undefined
			: text("podcast.played", { count: summary.watchedEpisodes });
	return [text("podcast.episode-count", { count: total }), played]
		.filter((part) => part !== undefined)
		.join(" · ");
};

export function PodcastEpisodesTab(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly safeAreaTop: number;
	readonly logger: MediaActivityLogger;
	readonly summary: undefined | PodcastSummary;
}) {
	const text = useMediaMessages();
	const counts = podcastEpisodeCountLine(text, props.summary);
	const { summary } = props;
	const editable = summary?.isCustom === true;
	return (
		<div className={clsx("flex flex-col", props.compact ? "gap-5 pt-6" : "gap-6 pt-8")}>
			{counts === undefined ? null : (
				<p className="font-ui text-[12px] text-text-subtle">{counts}</p>
			)}
			{summary?.isCustom === true ? (
				<div className="flex">
					<MediaChildCreateAction
						parentEntityId={props.entityId}
						childSchemaSlug="podcast-episode"
						label={text("podcast.add-episode")}
						initialProperties={{
							episodeNumber: summary.airedEpisodes + summary.upcomingEpisodes + 1,
						}}
					/>
				</div>
			) : null}
			<MediaEpisodePages
				editable={editable}
				compact={props.compact}
				entityId={props.entityId}
				containerId={props.entityId}
				query={podcastEpisodesQuery}
				safeAreaTop={props.safeAreaTop}
				render={PODCAST_EPISODE_RENDER}
				copy={podcastEpisodePagesCopy(text)}
				nextUp={props.summary?.nextUp ?? null}
				log={{ logger: props.logger, parentEntityId: props.entityId }}
			/>
		</div>
	);
}
