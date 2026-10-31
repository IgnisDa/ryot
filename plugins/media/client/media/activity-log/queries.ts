import {
	createRyotBackgroundSubmission,
	createRyotQuery,
	type RyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";

import {
	type EpisodicEarlierUnwatched,
	episodicEarlierUnwatchedRecipe,
	type MediaActivityLogContext,
	mediaActivityLogContextRecipe,
	type ShowSeasonEpisodeChoices,
	showSeasonEpisodeChoicesRecipe,
} from "../../../shared/activity-log-recipes";
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
			mediaActivityLogContextRecipe({
				entityId: input.entityId,
				reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
			}),
		),
	{ entityWatch: ({ input }) => ({ visible: [], foreground: [input.entityId] }) },
);

export const showSeasonChoicesQuery = createRyotQuery<
	{ readonly after: null | string; readonly seasonNumber: number; readonly showEntityId: string },
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
		readonly after: null | string;
		readonly parentEntityId: string;
		readonly episodeEntityId: string;
		readonly kind: "show" | "podcast";
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
