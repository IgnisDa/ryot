import { notifications } from "@mantine/notifications";
import {
	MediaLot,
	type MetadataProgressUpdateCommonInput,
} from "@ryot/generated/graphql/backend/graphql";
import { isFiniteNumber } from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { WatchTimes } from "~/components/routes/dashboard/types";
import type { MetadataDetails } from "~/components/routes/media-item/types";
import type { BulkUpdateContext } from "./form-types";

type EpisodeWithSeason = NonNullable<
	MetadataDetails["showSpecifics"]
>["seasons"][number]["episodes"][number] & { seasonNumber: number };

export const createCustomDatesCompletedChange = (params: {
	startDateFormatted: string | null;
	additionalFields?: MetadataFields;
	finishDateFormatted: string | null;
	commonFields: MetadataProgressUpdateCommonInput;
}) => {
	if (params.startDateFormatted && params.finishDateFormatted) {
		return {
			createNewCompleted: {
				startedAndFinishedOnDate: {
					...params.commonFields,
					...(params.additionalFields || {}),
					startedOn: params.startDateFormatted,
					timestamp: params.finishDateFormatted,
				},
			},
		};
	}
	if (params.startDateFormatted) {
		return {
			createNewCompleted: {
				startedOnDate: {
					...params.commonFields,
					...(params.additionalFields || {}),
					timestamp: params.startDateFormatted,
				},
			},
		};
	}
	if (params.finishDateFormatted) {
		return {
			createNewCompleted: {
				finishedOnDate: {
					...params.commonFields,
					...(params.additionalFields || {}),
					timestamp: params.finishDateFormatted,
				},
			},
		};
	}
	throw new Error("At least one date must be provided for CustomDates");
};

type MetadataFields =
	| { mangaVolumeNumber: number }
	| { animeEpisodeNumber: number }
	| { mangaChapterNumber: string }
	| { podcastEpisodeNumber: number }
	| { showSeasonNumber: number; showEpisodeNumber: number };

type CreateUpdateChangeInput = {
	watchTime: WatchTimes;
	fields: MetadataFields;
	currentDateFormatted: string;
	startDateFormatted: string | null;
	finishDateFormatted: string | null;
	common: MetadataProgressUpdateCommonInput;
};

const createUpdateChange = (input: CreateUpdateChangeInput) => {
	return match(input.watchTime)
		.with(WatchTimes.JustStartedIt, () => ({
			createNewInProgress: {
				...input.common,
				...input.fields,
				startedOn: input.currentDateFormatted,
			},
		}))
		.with(WatchTimes.JustCompletedNow, () => ({
			createNewCompleted: {
				finishedOnDate: {
					...input.common,
					...input.fields,
					timestamp: input.currentDateFormatted,
				},
			},
		}))
		.with(WatchTimes.CustomDates, () =>
			createCustomDatesCompletedChange({
				commonFields: input.common,
				additionalFields: input.fields,
				startDateFormatted: input.startDateFormatted,
				finishDateFormatted: input.finishDateFormatted,
			}),
		)
		.with(WatchTimes.IDontRemember, () => ({
			createNewCompleted: {
				withoutDates: { ...input.common, ...input.fields },
			},
		}))
		.exhaustive();
};

const handleAnimeBulkUpdates = (context: BulkUpdateContext) => {
	if (
		context.metadataDetails.lot === MediaLot.Anime &&
		context.metadataToUpdate.animeAllEpisodesBefore &&
		context.metadataToUpdate.animeEpisodeNumber
	) {
		const latestHistoryItem = context.history[0];
		const lastSeenEpisode =
			latestHistoryItem?.animeExtraInformation?.episode || 0;
		for (
			let i = lastSeenEpisode + 1;
			i < context.metadataToUpdate.animeEpisodeNumber;
			i++
		) {
			context.updates.push({
				metadataId: context.metadataToUpdate.metadataId,
				change: createUpdateChange({
					common: context.common,
					watchTime: context.watchTime,
					fields: { animeEpisodeNumber: i },
					startDateFormatted: context.startDateFormatted,
					finishDateFormatted: context.finishDateFormatted,
					currentDateFormatted: context.currentDateFormatted,
				}),
			});
		}
	}
};

const handleMangaBulkUpdates = (context: BulkUpdateContext) => {
	if (
		context.metadataDetails.lot === MediaLot.Manga &&
		context.metadataToUpdate.mangaAllChaptersOrVolumesBefore
	) {
		const latestHistoryItem = context.history[0];
		const mangaVolumeNumber = Number(
			context.metadataToUpdate.mangaVolumeNumber,
		);
		const mangaChapterNumber = Number(
			context.metadataToUpdate.mangaChapterNumber,
		);

		const hasValidChapter = isFiniteNumber(mangaChapterNumber);
		const hasValidVolume = isFiniteNumber(mangaVolumeNumber);

		if (
			(hasValidChapter && hasValidVolume) ||
			(!hasValidChapter && !hasValidVolume)
		) {
			const message =
				"Exactly one of mangaChapterNumber or mangaVolumeNumber must be provided";
			notifications.show({ color: "red", message: message });
			throw new Error(message);
		}

		if (mangaVolumeNumber) {
			const lastSeenVolume =
				latestHistoryItem?.mangaExtraInformation?.volume || 0;
			for (let i = lastSeenVolume + 1; i < mangaVolumeNumber; i++) {
				context.updates.push({
					metadataId: context.metadataToUpdate.metadataId,
					change: createUpdateChange({
						common: context.common,
						watchTime: context.watchTime,
						fields: { mangaVolumeNumber: i },
						startDateFormatted: context.startDateFormatted,
						finishDateFormatted: context.finishDateFormatted,
						currentDateFormatted: context.currentDateFormatted,
					}),
				});
			}
		}

		if (mangaChapterNumber) {
			const targetChapter = Number(mangaChapterNumber);
			const markedChapters = new Set();

			for (const historyItem of context.history) {
				const chapter = Number(historyItem?.mangaExtraInformation?.chapter);
				if (!Number.isNaN(chapter) && chapter < targetChapter) {
					markedChapters.add(chapter);
				}
			}

			for (let i = 1; i < targetChapter; i++) {
				if (!markedChapters.has(i)) {
					context.updates.push({
						metadataId: context.metadataToUpdate.metadataId,
						change: createUpdateChange({
							common: context.common,
							watchTime: context.watchTime,
							fields: { mangaChapterNumber: i.toString() },
							startDateFormatted: context.startDateFormatted,
							finishDateFormatted: context.finishDateFormatted,
							currentDateFormatted: context.currentDateFormatted,
						}),
					});
				}
			}
		}
	}
};

const handleShowBulkUpdates = (context: BulkUpdateContext) => {
	if (
		context.metadataDetails.lot === MediaLot.Show &&
		(context.metadataToUpdate.showAllEpisodesBefore ||
			context.metadataToUpdate.showSeasonEpisodesBefore) &&
		context.metadataToUpdate.showSeasonNumber &&
		context.metadataToUpdate.showEpisodeNumber
	) {
		const allEpisodesInShow =
			context.metadataDetails.showSpecifics?.seasons.flatMap((s) =>
				s.episodes.map((e) => ({ seasonNumber: s.seasonNumber, ...e })),
			) || [];

		const selectedEpisode = allEpisodesInShow.find(
			(e) =>
				e.seasonNumber === context.metadataToUpdate.showSeasonNumber &&
				e.episodeNumber === context.metadataToUpdate.showEpisodeNumber,
		);

		if (!selectedEpisode) return;

		const seenEpisodes = new Set<string>();
		for (const historyItem of context.history) {
			if (historyItem.showExtraInformation) {
				const season = historyItem.showExtraInformation.season;
				const episode = historyItem.showExtraInformation.episode;
				seenEpisodes.add(`S${season}E${episode}`);
			}
		}

		const episodeComesAfterOrIs = (
			episodeA: EpisodeWithSeason,
			episodeB: EpisodeWithSeason,
		) => {
			if (episodeA.seasonNumber > episodeB.seasonNumber) return true;
			if (episodeA.seasonNumber === episodeB.seasonNumber) {
				return episodeA.episodeNumber >= episodeB.episodeNumber;
			}
			return false;
		};

		const episodesToConsider = allEpisodesInShow.filter((episode) => {
			if (episodeComesAfterOrIs(episode, selectedEpisode)) return false;

			if (context.metadataToUpdate.showSeasonEpisodesBefore) {
				if (episode.seasonNumber !== selectedEpisode.seasonNumber) return false;
			}

			if (episode.seasonNumber === 0 && selectedEpisode.seasonNumber !== 0) {
				return false;
			}

			return true;
		});

		for (const episode of episodesToConsider) {
			const episodeKey = `S${episode.seasonNumber}E${episode.episodeNumber}`;
			if (!seenEpisodes.has(episodeKey)) {
				context.updates.push({
					metadataId: context.metadataToUpdate.metadataId,
					change: createUpdateChange({
						common: context.common,
						watchTime: context.watchTime,
						startDateFormatted: context.startDateFormatted,
						finishDateFormatted: context.finishDateFormatted,
						currentDateFormatted: context.currentDateFormatted,
						fields: {
							showSeasonNumber: episode.seasonNumber,
							showEpisodeNumber: episode.episodeNumber,
						},
					}),
				});
			}
		}
	}
};

const handlePodcastBulkUpdates = (context: BulkUpdateContext) => {
	if (
		context.metadataDetails.lot === MediaLot.Podcast &&
		context.metadataToUpdate.podcastAllEpisodesBefore &&
		context.metadataToUpdate.podcastEpisodeNumber
	) {
		const latestHistoryItem = context.history[0];
		const podcastSpecifics =
			context.metadataDetails.podcastSpecifics?.episodes || [];
		const selectedEpisode = podcastSpecifics.find(
			(e) => e.number === context.metadataToUpdate.podcastEpisodeNumber,
		);

		if (selectedEpisode) {
			const lastSeenEpisode =
				latestHistoryItem?.podcastExtraInformation?.episode || 0;

			const allUnseenEpisodesBefore = podcastSpecifics.filter(
				(e) => e.number < selectedEpisode.number && e.number > lastSeenEpisode,
			);

			for (const episode of allUnseenEpisodesBefore) {
				context.updates.push({
					metadataId: context.metadataToUpdate.metadataId,
					change: createUpdateChange({
						common: context.common,
						watchTime: context.watchTime,
						startDateFormatted: context.startDateFormatted,
						fields: { podcastEpisodeNumber: episode.number },
						finishDateFormatted: context.finishDateFormatted,
						currentDateFormatted: context.currentDateFormatted,
					}),
				});
			}
		}
	}
};

export const processBulkUpdates = (context: BulkUpdateContext) => {
	handleAnimeBulkUpdates(context);
	handleMangaBulkUpdates(context);
	handleShowBulkUpdates(context);
	handlePodcastBulkUpdates(context);
};
