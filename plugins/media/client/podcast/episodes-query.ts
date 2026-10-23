import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { podcastEpisodesRecipe } from "../../shared/podcast-recipes";
import type { MediaCursorPage } from "../media/cursor-page-state";
import type { MediaEpisodePageInput } from "../media/episodes";

const PODCAST_EPISODE_PAGE_LIMIT = 40;

export type PodcastEpisode = Recipe.Success<typeof podcastEpisodesRecipe>["items"][number];

export const podcastEpisodesQuery = createRyotQuery<
	MediaEpisodePageInput,
	MediaCursorPage<PodcastEpisode>
>(
	({ input, client }) =>
		client.data.query(
			podcastEpisodesRecipe({
				containerId: input.containerId,
				limit: PODCAST_EPISODE_PAGE_LIMIT,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				...(input.after === null ? {} : { after: input.after }),
			}),
		),
	{
		entityWatch: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.items.map(({ id }) => id) ?? [],
		}),
	},
);
