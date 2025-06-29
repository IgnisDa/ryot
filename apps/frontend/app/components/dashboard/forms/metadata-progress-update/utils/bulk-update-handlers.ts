import { notifications } from "@mantine/notifications";
import {
	MediaLot,
	type MetadataProgressUpdateCommonInput,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber } from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { WatchTimes } from "../../../types";
import type { BulkUpdateContext } from "./form-types";

type MetadataFields =
	| { animeEpisodeNumber: number }
	| { mangaVolumeNumber: number }
	| { mangaChapterNumber: string }
	| { showSeasonNumber: number; showEpisodeNumber: number }
	| { podcastEpisodeNumber: number };

type CreateUpdateChangeInput = {
	watchTime: WatchTimes;
	currentDateFormatted: string;
	startDateFormatted: string | null;
	finishDateFormatted: string | null;
	common: MetadataProgressUpdateCommonInput;
	fields: MetadataFields;
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
		.with(WatchTimes.CustomDates, () => {
			if (input.startDateFormatted && input.finishDateFormatted) {
				return {
					createNewCompleted: {
						startedAndFinishedOnDate: {
							...input.common,
							...input.fields,
							startedOn: input.startDateFormatted,
							timestamp: input.finishDateFormatted,
						},
					},
				};
			}
			if (input.startDateFormatted) {
				return {
					createNewCompleted: {
						startedOnDate: {
							...input.common,
							...input.fields,
							timestamp: input.startDateFormatted,
						},
					},
				};
			}
			if (input.finishDateFormatted) {
				return {
					createNewCompleted: {
						finishedOnDate: {
							...input.common,
							...input.fields,
							timestamp: input.finishDateFormatted,
						},
					},
				};
			}
			throw new Error("At least one date must be provided for CustomDates");
		})
		.with(WatchTimes.IDontRemember, () => ({
			createNewCompleted: {
				withoutDates: {
					...input.common,
					...input.fields,
				},
			},
		}))
		.exhaustive();
};

const handleAnimeBulkUpdates = (context: BulkUpdateContext): void => {
	const {
		metadataDetails,
		metadataToUpdate,
		history,
		watchTime,
		currentDateFormatted,
		startDateFormatted,
		finishDateFormatted,
		common,
		updates,
	} = context;

	if (
		metadataDetails.lot === MediaLot.Anime &&
		metadataToUpdate.animeAllEpisodesBefore &&
		metadataToUpdate.animeEpisodeNumber
	) {
		const latestHistoryItem = history[0];
		const lastSeenEpisode =
			latestHistoryItem?.animeExtraInformation?.episode || 0;
		for (
			let i = lastSeenEpisode + 1;
			i < metadataToUpdate.animeEpisodeNumber;
			i++
		) {
			updates.push({
				metadataId: metadataToUpdate.metadataId,
				change: createUpdateChange({
					watchTime,
					currentDateFormatted,
					startDateFormatted,
					finishDateFormatted,
					common,
					fields: { animeEpisodeNumber: i },
				}),
			});
		}
	}
};

const handleMangaBulkUpdates = (context: BulkUpdateContext): void => {
	const {
		metadataDetails,
		metadataToUpdate,
		history,
		watchTime,
		currentDateFormatted,
		startDateFormatted,
		finishDateFormatted,
		common,
		updates,
	} = context;

	if (
		metadataDetails.lot === MediaLot.Manga &&
		metadataToUpdate.mangaAllChaptersOrVolumesBefore
	) {
		const latestHistoryItem = history[0];

		const hasValidChapter = isNumber(metadataToUpdate.mangaChapterNumber);
		const hasValidVolume = isNumber(metadataToUpdate.mangaVolumeNumber);

		if (
			(hasValidChapter && hasValidVolume) ||
			(!hasValidChapter && !hasValidVolume)
		) {
			notifications.show({
				color: "red",
				message:
					"Exactly one of mangaChapterNumber or mangaVolumeNumber must be provided",
			});
			return;
		}

		if (metadataToUpdate.mangaVolumeNumber) {
			const lastSeenVolume =
				latestHistoryItem?.mangaExtraInformation?.volume || 0;
			for (
				let i = lastSeenVolume + 1;
				i < metadataToUpdate.mangaVolumeNumber;
				i++
			) {
				updates.push({
					metadataId: metadataToUpdate.metadataId,
					change: createUpdateChange({
						watchTime,
						currentDateFormatted,
						startDateFormatted,
						finishDateFormatted,
						common,
						fields: { mangaVolumeNumber: i },
					}),
				});
			}
		}

		if (metadataToUpdate.mangaChapterNumber) {
			const targetChapter = Number(metadataToUpdate.mangaChapterNumber);
			const markedChapters = new Set();

			for (const historyItem of history) {
				const chapter = Number(historyItem?.mangaExtraInformation?.chapter);
				if (!Number.isNaN(chapter) && chapter < targetChapter) {
					markedChapters.add(chapter);
				}
			}

			for (let i = 1; i < targetChapter; i++) {
				if (!markedChapters.has(i)) {
					updates.push({
						metadataId: metadataToUpdate.metadataId,
						change: createUpdateChange({
							watchTime,
							currentDateFormatted,
							startDateFormatted,
							finishDateFormatted,
							common,
							fields: { mangaChapterNumber: i.toString() },
						}),
					});
				}
			}
		}
	}
};

const handleShowBulkUpdates = (context: BulkUpdateContext): void => {
	const {
		metadataDetails,
		metadataToUpdate,
		history,
		watchTime,
		currentDateFormatted,
		startDateFormatted,
		finishDateFormatted,
		common,
		updates,
	} = context;

	if (
		metadataDetails.lot === MediaLot.Show &&
		metadataToUpdate.showAllEpisodesBefore &&
		metadataToUpdate.showSeasonNumber &&
		metadataToUpdate.showEpisodeNumber
	) {
		const latestHistoryItem = history[0];
		const allEpisodesInShow =
			metadataDetails.showSpecifics?.seasons.flatMap((s) =>
				s.episodes.map((e) => ({ seasonNumber: s.seasonNumber, ...e })),
			) || [];

		const selectedEpisodeIndex = allEpisodesInShow.findIndex(
			(e) =>
				e.seasonNumber === metadataToUpdate.showSeasonNumber &&
				e.episodeNumber === metadataToUpdate.showEpisodeNumber,
		);

		const selectedEpisode = allEpisodesInShow[selectedEpisodeIndex];
		const firstEpisodeOfShow = allEpisodesInShow[0];
		const lastSeenEpisode = latestHistoryItem?.showExtraInformation || {
			episode: firstEpisodeOfShow?.episodeNumber,
			season: firstEpisodeOfShow?.seasonNumber,
		};

		const lastSeenEpisodeIndex = allEpisodesInShow.findIndex(
			(e) =>
				e.seasonNumber === lastSeenEpisode.season &&
				e.episodeNumber === lastSeenEpisode.episode,
		);

		const firstEpisodeIndexToMark =
			lastSeenEpisodeIndex + (latestHistoryItem ? 1 : 0);

		if (selectedEpisodeIndex > firstEpisodeIndexToMark) {
			for (let i = firstEpisodeIndexToMark; i < selectedEpisodeIndex; i++) {
				const currentEpisode = allEpisodesInShow[i];
				if (
					currentEpisode.seasonNumber === 0 &&
					selectedEpisode.seasonNumber !== 0
				) {
					// Skip special episodes (season 0) unless the target is also in season 0
					continue;
				}

				updates.push({
					metadataId: metadataToUpdate.metadataId,
					change: createUpdateChange({
						watchTime,
						currentDateFormatted,
						startDateFormatted,
						finishDateFormatted,
						common,
						fields: {
							showSeasonNumber: currentEpisode.seasonNumber,
							showEpisodeNumber: currentEpisode.episodeNumber,
						},
					}),
				});
			}
		}
	}
};

const handlePodcastBulkUpdates = (context: BulkUpdateContext): void => {
	const {
		metadataDetails,
		metadataToUpdate,
		history,
		watchTime,
		currentDateFormatted,
		startDateFormatted,
		finishDateFormatted,
		common,
		updates,
	} = context;

	if (
		metadataDetails.lot === MediaLot.Podcast &&
		metadataToUpdate.podcastAllEpisodesBefore &&
		metadataToUpdate.podcastEpisodeNumber
	) {
		const latestHistoryItem = history[0];
		const podcastSpecifics = metadataDetails.podcastSpecifics?.episodes || [];
		const selectedEpisode = podcastSpecifics.find(
			(e) => e.number === metadataToUpdate.podcastEpisodeNumber,
		);

		if (selectedEpisode) {
			const lastSeenEpisode =
				latestHistoryItem?.podcastExtraInformation?.episode || 0;

			const allUnseenEpisodesBefore = podcastSpecifics.filter(
				(e) => e.number < selectedEpisode.number && e.number > lastSeenEpisode,
			);

			for (const episode of allUnseenEpisodesBefore) {
				updates.push({
					metadataId: metadataToUpdate.metadataId,
					change: createUpdateChange({
						watchTime,
						currentDateFormatted,
						startDateFormatted,
						finishDateFormatted,
						common,
						fields: { podcastEpisodeNumber: episode.number },
					}),
				});
			}
		}
	}
};

export const processBulkUpdates = (context: BulkUpdateContext): void => {
	handleAnimeBulkUpdates(context);
	handleMangaBulkUpdates(context);
	handleShowBulkUpdates(context);
	handlePodcastBulkUpdates(context);
};
