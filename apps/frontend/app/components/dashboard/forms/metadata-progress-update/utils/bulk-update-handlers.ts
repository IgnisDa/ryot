import { notifications } from "@mantine/notifications";
import { MediaLot } from "@ryot/generated/graphql/backend/graphql";
import { isNumber } from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { WatchTimes } from "../../../types";
import type { BulkUpdateContext } from "./form-types";

export const handleAnimeBulkUpdates = (context: BulkUpdateContext): void => {
	const {
		metadataDetails,
		metadataToUpdate,
		history,
		watchTime,
		currentDateFormatted,
		selectedDateFormatted,
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
				change: match(watchTime)
					.with(WatchTimes.JustStartedIt, () => ({
						createNewInProgress: {
							...common,
							animeEpisodeNumber: i,
							startedOn: currentDateFormatted,
						},
					}))
					.with(WatchTimes.JustCompletedNow, () => ({
						createNewCompleted: {
							finishedOnDate: {
								...common,
								animeEpisodeNumber: i,
								timestamp: currentDateFormatted,
							},
						},
					}))
					.with(WatchTimes.CustomDates, () => {
						if (!selectedDateFormatted)
							throw new Error("Selected date is undefined");
						return {
							createNewCompleted: {
								finishedOnDate: {
									...common,
									animeEpisodeNumber: i,
									timestamp: selectedDateFormatted,
								},
							},
						};
					})
					.with(WatchTimes.IDontRemember, () => ({
						createNewCompleted: {
							withoutDates: {
								...common,
								animeEpisodeNumber: i,
							},
						},
					}))
					.exhaustive(),
			});
		}
	}
};

export const handleMangaBulkUpdates = (context: BulkUpdateContext): void => {
	const {
		metadataDetails,
		metadataToUpdate,
		history,
		watchTime,
		currentDateFormatted,
		selectedDateFormatted,
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
					change: match(watchTime)
						.with(WatchTimes.JustStartedIt, () => ({
							createNewInProgress: {
								...common,
								mangaVolumeNumber: i,
								startedOn: currentDateFormatted,
							},
						}))
						.with(WatchTimes.JustCompletedNow, () => ({
							createNewCompleted: {
								finishedOnDate: {
									...common,
									mangaVolumeNumber: i,
									timestamp: currentDateFormatted,
								},
							},
						}))
						.with(WatchTimes.CustomDates, () => {
							if (!selectedDateFormatted)
								throw new Error("Selected date is undefined");
							return {
								createNewCompleted: {
									finishedOnDate: {
										...common,
										mangaVolumeNumber: i,
										timestamp: selectedDateFormatted,
									},
								},
							};
						})
						.with(WatchTimes.IDontRemember, () => ({
							createNewCompleted: {
								withoutDates: {
									...common,
									mangaVolumeNumber: i,
								},
							},
						}))
						.exhaustive(),
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
						change: match(watchTime)
							.with(WatchTimes.JustStartedIt, () => ({
								createNewInProgress: {
									...common,
									mangaChapterNumber: i.toString(),
									startedOn: currentDateFormatted,
								},
							}))
							.with(WatchTimes.JustCompletedNow, () => ({
								createNewCompleted: {
									finishedOnDate: {
										...common,
										mangaChapterNumber: i.toString(),
										timestamp: currentDateFormatted,
									},
								},
							}))
							.with(WatchTimes.CustomDates, () => {
								if (!selectedDateFormatted)
									throw new Error("Selected date is undefined");
								return {
									createNewCompleted: {
										finishedOnDate: {
											...common,
											mangaChapterNumber: i.toString(),
											timestamp: selectedDateFormatted,
										},
									},
								};
							})
							.with(WatchTimes.IDontRemember, () => ({
								createNewCompleted: {
									withoutDates: {
										...common,
										mangaChapterNumber: i.toString(),
									},
								},
							}))
							.exhaustive(),
					});
				}
			}
		}
	}
};

export const handleShowBulkUpdates = (context: BulkUpdateContext): void => {
	const {
		metadataDetails,
		metadataToUpdate,
		history,
		watchTime,
		currentDateFormatted,
		selectedDateFormatted,
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
					change: match(watchTime)
						.with(WatchTimes.JustStartedIt, () => ({
							createNewInProgress: {
								...common,
								showSeasonNumber: currentEpisode.seasonNumber,
								showEpisodeNumber: currentEpisode.episodeNumber,
								startedOn: currentDateFormatted,
							},
						}))
						.with(WatchTimes.JustCompletedNow, () => ({
							createNewCompleted: {
								finishedOnDate: {
									...common,
									timestamp: currentDateFormatted,
									showSeasonNumber: currentEpisode.seasonNumber,
									showEpisodeNumber: currentEpisode.episodeNumber,
								},
							},
						}))
						.with(WatchTimes.CustomDates, () => {
							if (!selectedDateFormatted)
								throw new Error("Selected date is undefined");
							return {
								createNewCompleted: {
									finishedOnDate: {
										...common,
										timestamp: selectedDateFormatted,
										showSeasonNumber: currentEpisode.seasonNumber,
										showEpisodeNumber: currentEpisode.episodeNumber,
									},
								},
							};
						})
						.with(WatchTimes.IDontRemember, () => ({
							createNewCompleted: {
								withoutDates: {
									...common,
									showSeasonNumber: currentEpisode.seasonNumber,
									showEpisodeNumber: currentEpisode.episodeNumber,
								},
							},
						}))
						.exhaustive(),
				});
			}
		}
	}
};

export const handlePodcastBulkUpdates = (context: BulkUpdateContext): void => {
	const {
		metadataDetails,
		metadataToUpdate,
		history,
		watchTime,
		currentDateFormatted,
		selectedDateFormatted,
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
					change: match(watchTime)
						.with(WatchTimes.JustStartedIt, () => ({
							createNewInProgress: {
								...common,
								podcastEpisodeNumber: episode.number,
								startedOn: currentDateFormatted,
							},
						}))
						.with(WatchTimes.JustCompletedNow, () => ({
							createNewCompleted: {
								finishedOnDate: {
									...common,
									timestamp: currentDateFormatted,
									podcastEpisodeNumber: episode.number,
								},
							},
						}))
						.with(WatchTimes.CustomDates, () => {
							if (!selectedDateFormatted)
								throw new Error("Selected date is undefined");
							return {
								createNewCompleted: {
									finishedOnDate: {
										...common,
										timestamp: selectedDateFormatted,
										podcastEpisodeNumber: episode.number,
									},
								},
							};
						})
						.with(WatchTimes.IDontRemember, () => ({
							createNewCompleted: {
								withoutDates: {
									...common,
									podcastEpisodeNumber: episode.number,
								},
							},
						}))
						.exhaustive(),
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
