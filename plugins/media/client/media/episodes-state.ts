import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import type { Formatters } from "@ryot-app/plugin-client-sdk/react";
import { collectManagedAssetLocators } from "@ryot-app/plugin-client-sdk/react";

import type { EntitySyncFields } from "../../shared/entity-selections";
import type { EpisodeLifecycleState } from "../../shared/lifecycle-expressions";
import type { MediaImageAsset } from "../../shared/media-image";
import { catalogMessage } from "../../shared/messages.generated";
import type { MediaCopy, MediaText } from "../messages";
import { optionalText } from "./activity-timeline";
import { formatDateOnlyLabel } from "./date";

export type MediaEpisodeStateLabels = Record<EpisodeLifecycleState, undefined | LocalMessage>;

export type MediaEpisode = EntitySyncFields & {
	readonly id: string;
	readonly name: string;
	readonly episodeNumber: number;
	readonly runtime: null | number;
	readonly publishDate: null | string;
	readonly description: null | string;
	readonly state: EpisodeLifecycleState;
	readonly image: null | MediaImageAsset;
};

export const mediaDateLabel = (formatters: Formatters, value: null | string) => {
	const date = optionalText(value);
	return date === undefined ? undefined : formatDateOnlyLabel(formatters, date);
};

export const mediaEpisodesManagedAssets = (episodes: readonly MediaEpisode[]) =>
	collectManagedAssetLocators(episodes.map((episode) => episode.image ?? undefined));

export const mediaEpisodeStateLabel = (
	state: EpisodeLifecycleState,
	labels: MediaEpisodeStateLabels,
) => labels[state];

export const mediaEpisodeSynopsis = (episode: MediaEpisode) => optionalText(episode.description);

export const mediaEpisodeAirDateLabel = (formatters: Formatters, episode: MediaEpisode) =>
	mediaDateLabel(formatters, episode.publishDate);

export const mediaEpisodeRuntimeLabel = (text: MediaText, episode: MediaEpisode) =>
	episode.runtime === null ? undefined : text("episode.runtime", { minutes: episode.runtime });

export const mediaEpisodeMetadataLabel = ({ text, formatters }: MediaCopy, episode: MediaEpisode) =>
	[mediaEpisodeAirDateLabel(formatters, episode), mediaEpisodeRuntimeLabel(text, episode)]
		.filter((part) => part !== undefined)
		.join(" · ");

export const mediaEpisodeNumberLabel = (episode: { readonly episodeNumber: number }) =>
	catalogMessage("episode.number", { episode: episode.episodeNumber });
