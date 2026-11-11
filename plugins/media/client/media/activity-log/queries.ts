import {
	createRyotBackgroundSubmission,
	createRyotQuery,
	type RyotSubmission,
	useBackgroundSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import {
	type EpisodicEarlierUnwatched,
	episodicEarlierUnwatchedRecipe,
	type MediaActivityLogContext,
	mediaActivityLogContextRecipe,
	showEpisodeSeasonRecipe,
	showSeasonChoicesRecipe,
	type ShowSeasonEpisodeChoices,
	showSeasonEpisodeChoicesRecipe,
} from "../../../shared/activity-log-recipes";
import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../../shared/lifecycle-expressions";
import {
	MediaActivityDeleteInput,
	MediaActivityLogInput,
	type MediaActivityPatch,
	MediaActivityUpdateInput,
	type MediaEventSnapshot,
} from "../../../shared/media-activity-operations";
import { PLUGIN_PACKAGE_ID } from "../../../shared/plugin-identity";
import { type ActivityEntryDraft, activityLogInput, EARLIER_PAGE_LIMIT } from "./state";

const SEASON_CHOICES_LIMIT = 100;

export const activityLogContextQuery = createRyotQuery<
	{ readonly entityId: string },
	null | MediaActivityLogContext
>(
	({ input, client }) =>
		client.data.query(
			mediaActivityLogContextRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
			{ entityId: input.entityId },
		),
	{ entityWatch: ({ input }) => ({ visible: [], foreground: [input.entityId] }) },
);

export const showEpisodeSeasonQuery = createRyotQuery<
	{ readonly episodeEntityId: string },
	null | number
>(({ input, client }) =>
	client.data.query(showEpisodeSeasonRecipe, { episodeEntityId: input.episodeEntityId }),
);
export const showSeasonChoicesQuery = createRyotQuery<
	{ readonly after: null | string; readonly seasonNumber: number; readonly showEntityId: string },
	ShowSeasonEpisodeChoices
>(({ input, client }) =>
	client.data.query(
		showSeasonEpisodeChoicesRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		{ showEntityId: input.showEntityId, seasonNumber: input.seasonNumber },
		{ pages: { episodes: { limit: SEASON_CHOICES_LIMIT, after: input.after ?? undefined } } },
	),
);

export const activityLogSeasonsQuery = createRyotQuery<
	{ readonly entityId: string; readonly after: null | string },
	Recipe.Success<ReturnType<typeof showSeasonChoicesRecipe>>
>(({ input, client }) =>
	client.data.query(
		showSeasonChoicesRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		{ entityId: input.entityId },
		{ pages: { seasons: { limit: 40, after: input.after ?? undefined } } },
	),
);

export const earlierEpisodesQuery = createRyotQuery<
	{
		readonly after: null | string;
		readonly parentEntityId: string;
		readonly episodeEntityId: string;
		readonly kind: "show" | "podcast";
	},
	EpisodicEarlierUnwatched
>(({ input, client }) =>
	client.data.query(
		episodicEarlierUnwatchedRecipe({
			reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			config: input.kind === "show" ? showEpisodicKindConfig : podcastEpisodicKindConfig,
		}),
		{ parentEntityId: input.parentEntityId, episodeEntityId: input.episodeEntityId },
		{ pages: { episodes: { limit: EARLIER_PAGE_LIMIT, after: input.after ?? undefined } } },
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

/** A log submission owned by the opener, so a follow-up review can wait for it to settle. */
export const useActivityLogSubmission = () => useBackgroundSubmission(logActivitySubmission);

export type ActivityLogSubmission = ReturnType<typeof useActivityLogSubmission>;

export const updateActivitySubmission = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	label: () => "Edit activity",
	slug: "media-activity-update",
	inputSchema: MediaActivityUpdateInput,
	input: ({
		input,
		submittedAt,
		submissionId,
	}: RyotSubmission<{
		readonly eventId: string;
		readonly patch: MediaActivityPatch;
		readonly expected: MediaEventSnapshot;
	}>) => ({ ...input, submittedAt, submissionId }),
});

export const deleteActivitySubmission = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	slug: "media-activity-delete",
	inputSchema: MediaActivityDeleteInput,
	label: (input: { readonly eventIds: readonly string[] }) =>
		input.eventIds.length === 1 ? "Delete record" : `Delete ${input.eventIds.length} records`,
	input: ({
		input,
		submittedAt,
		submissionId,
	}: RyotSubmission<{
		readonly eventIds: readonly string[];
		readonly expected?: undefined | MediaEventSnapshot;
	}>) => ({
		submittedAt,
		submissionId,
		eventIds: input.eventIds,
		...(input.expected === undefined ? {} : { expected: input.expected }),
	}),
});
