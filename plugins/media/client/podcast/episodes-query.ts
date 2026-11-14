import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { podcastEpisodesRecipe } from "../../shared/podcast-recipes";
import type { MediaCursorPage } from "../media/cursor-page-state";
import type { MediaEpisodePageInput } from "../media/episodes";

const PODCAST_EPISODE_PAGE_LIMIT = 40;

export type PodcastEpisode = Recipe.Success<
	ReturnType<typeof podcastEpisodesRecipe>
>["items"][number];

export const podcastEpisodesQuery = createRyotQuery<
	MediaEpisodePageInput,
	MediaCursorPage<PodcastEpisode>
>(
	({ input, client }) =>
		client.data.query(
			podcastEpisodesRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
			{ containerId: input.containerId },
			{
				pages: { episodes: { after: input.after ?? undefined, limit: PODCAST_EPISODE_PAGE_LIMIT } },
			},
		),
	{
		entityWatch: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.items.map(({ id }) => id) ?? [],
		}),
	},
);
