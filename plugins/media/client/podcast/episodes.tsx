import clsx from "clsx";

import type { MediaSummaryOf } from "../../shared/media-recipes";
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
import { mediaCountLabel } from "../media/summary-state";
import { type PodcastEpisode, podcastEpisodesQuery } from "./episodes-query";

type PodcastSummary = MediaSummaryOf<typeof podcastRecipes>;

export const podcastEpisodeOriginLabel = (episode: { readonly episodeNumber: number }) =>
	`Ep ${episode.episodeNumber}`;

const PODCAST_EPISODE_RENDER: MediaEpisodeRender<PodcastEpisode> = {
	aspect: "square",
	purpose: "cover",
	entitySchemaSlug: "podcast-episode",
	numberLabel: mediaEpisodeNumberLabel,
	originLabel: podcastEpisodeOriginLabel,
	stateLabels: { complete: "Played", untracked: undefined, in_progress: "In progress" },
	activityEpisode: (episode) => ({
		id: episode.id,
		seasonNumber: null,
		name: episode.name,
		state: episode.state,
		episodeNumber: episode.episodeNumber,
	}),
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
	const total = summary.totalEpisodes ?? summary.airedEpisodes;
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
	readonly logger: MediaActivityLogger;
	readonly entityId: string;
	readonly safeAreaTop: number;
	readonly summary: PodcastSummary | undefined;
}) {
	const counts = podcastEpisodeCountLine(props.summary);
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
						label="Add episode"
						parentEntityId={props.entityId}
						childSchemaSlug="podcast-episode"
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
				copy={PODCAST_EPISODE_PAGES_COPY}
				nextUp={props.summary?.nextUp ?? null}
				log={{ logger: props.logger, parentEntityId: props.entityId }}
			/>
		</div>
	);
}
