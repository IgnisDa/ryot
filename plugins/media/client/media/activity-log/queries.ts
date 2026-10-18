import { createRyotBackgroundSubmission, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import {
	type EpisodicEarlierUnwatched,
	episodicEarlierUnwatchedRecipe,
	type MediaActivityLogContext,
	mediaActivityLogContextRecipe,
	type ShowSeasonEpisodeChoices,
	showSeasonEpisodeChoicesRecipe,
} from "../../../shared/activity-log-recipes";
import { MediaActivityLogInput } from "../../../shared/media-activity-operations";
import { PLUGIN_PACKAGE_ID } from "../../../shared/plugin-identity";
import { type ActivityEntryDraft, activityLogInput, EARLIER_PAGE_LIMIT } from "./state";

const SEASON_CHOICES_LIMIT = 100;

export const activityLogContextQuery = createRyotQuery<
	{ readonly entityId: string },
	MediaActivityLogContext | null
>(
	({ input, client }) =>
		client.data.query(
			mediaActivityLogContextRecipe({
				entityId: input.entityId,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	{ entityWatch: ({ input }) => ({ visible: [], foreground: [input.entityId] }) },
);

export const showSeasonChoicesQuery = createRyotQuery<
	{ readonly after: string | null; readonly seasonNumber: number; readonly showEntityId: string },
	ShowSeasonEpisodeChoices
>(({ input, client }) =>
	client.data.query(
		showSeasonEpisodeChoicesRecipe({
			limit: SEASON_CHOICES_LIMIT,
			showEntityId: input.showEntityId,
			seasonNumber: input.seasonNumber,
			reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			...(input.after === null ? {} : { after: input.after }),
		}),
	),
);

export const earlierEpisodesQuery = createRyotQuery<
	{
		readonly after: string | null;
		readonly kind: "show" | "podcast";
		readonly parentEntityId: string;
		readonly episodeEntityId: string;
	},
	EpisodicEarlierUnwatched
>(({ input, client }) =>
	client.data.query(
		episodicEarlierUnwatchedRecipe({
			kind: input.kind,
			limit: EARLIER_PAGE_LIMIT,
			parentEntityId: input.parentEntityId,
			episodeEntityId: input.episodeEntityId,
			reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			...(input.after === null ? {} : { after: input.after }),
		}),
	),
);

export const logActivitySubmission = createRyotBackgroundSubmission({
	slug: "media-activity-log",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaActivityLogInput,
	label: (input: { readonly label: string; readonly entry: ActivityEntryDraft }) => input.label,
	input: ({ input, submittedAt, submissionId }) =>
		activityLogInput(input.entry, { submittedAt, submissionId }),
});
