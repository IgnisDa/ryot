import type { EntitySyncState } from "@ryot-app/client-ui-sdk/sync";

import type { EpisodeLifecycleState } from "../../shared/lifecycle-expressions";
import type { MediaImage } from "../../shared/media-image";
import { optionalText } from "./activity-timeline";
import { formatDateOnlyLabel } from "./date";
import { collectManagedAssetLocators, preferredMediaImageAsset, type MediaImages } from "./image";

export type MediaEpisodeImagePurpose = MediaImage["purpose"];

export type MediaEpisode = EntitySyncState & {
	readonly id: string;
	readonly name: string;
	readonly images: MediaImages;
	readonly episodeNumber: number;
	readonly runtime: number | null;
	readonly publishDate: string | null;
	readonly description: string | null;
	readonly state: EpisodeLifecycleState;
};

export type MediaEpisodeStateLabels = Record<EpisodeLifecycleState, string | undefined>;

/** Ordering-aware next-up rule: `forward` resumes a sequence, `latest` opens the newest arrival. */
export type MediaNextUpDirection = "forward" | "latest";

export const mediaDateLabel = (value: string | null) => {
	const text = optionalText(value);
	return text === undefined ? undefined : formatDateOnlyLabel(text);
};

export const mediaEpisodeAsset = (episode: MediaEpisode, purpose: MediaEpisodeImagePurpose) =>
	preferredMediaImageAsset(episode.images, purpose);

export const mediaEpisodesManagedAssets = (
	episodes: readonly MediaEpisode[],
	purpose: MediaEpisodeImagePurpose,
) => collectManagedAssetLocators(episodes.map((episode) => mediaEpisodeAsset(episode, purpose)));

export const mediaEpisodeStateLabel = (
	state: EpisodeLifecycleState,
	labels: MediaEpisodeStateLabels,
) => labels[state];

export const mediaEpisodeSynopsis = (episode: MediaEpisode) => optionalText(episode.description);

export const mediaEpisodeAirDateLabel = (episode: MediaEpisode) =>
	mediaDateLabel(episode.publishDate);

export const mediaEpisodeRuntimeLabel = (episode: MediaEpisode) =>
	episode.runtime === null ? undefined : `${episode.runtime} min`;

export const mediaEpisodeNumberLabel = (episode: { readonly episodeNumber: number }) =>
	`E${episode.episodeNumber}`;

export const mediaNextUpEpisode = <Episode extends MediaEpisode>(
	episodes: readonly Episode[],
	direction: MediaNextUpDirection,
) => {
	const inProgress = episodes.find((episode) => episode.state === "in_progress");
	if (inProgress !== undefined) {
		return inProgress;
	}
	if (direction === "latest") {
		return episodes.find((episode) => episode.state === "untracked");
	}
	const lastCompleted = episodes.reduce(
		(last, episode, index) => (episode.state === "complete" ? index : last),
		-1,
	);
	return lastCompleted === -1
		? undefined
		: episodes.slice(lastCompleted + 1).find((episode) => episode.state === "untracked");
};
