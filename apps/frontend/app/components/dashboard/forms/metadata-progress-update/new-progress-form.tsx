import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Stack } from "@mantine/core";
import type {
	MetadataProgressUpdateChange,
	MetadataProgressUpdateCommonInput,
	MetadataProgressUpdateInput,
} from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import { useState } from "react";
import { match } from "ts-pattern";
import { convertTimestampToUtcString } from "~/lib/common";
import { useDeployBulkMetadataProgressUpdate } from "~/lib/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import { WatchTimes } from "../../types";
import { AnimeForm } from "./media-types/anime-form";
import { MangaForm } from "./media-types/manga-form";
import { PodcastForm } from "./media-types/podcast-form";
import { ShowForm } from "./media-types/show-form";
import { processBulkUpdates } from "./utils/bulk-update-handlers";
import {
	CustomDatePicker,
	ProviderSelect,
	SubmitButton,
	WatchTimeSelect,
} from "./utils/common-elements";
import type { MetadataNewProgressFormProps } from "./utils/form-types";

export const MetadataNewProgressUpdateForm = ({
	history,
	onSubmit,
	metadataDetails,
	metadataToUpdate,
}: MetadataNewProgressFormProps) => {
	const [parent] = useAutoAnimate();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const [startDate, setStartDate] = useState<Date | null>(null);
	const [finishDate, setFinishDate] = useState<Date | null>(new Date());
	const [watchTime, setWatchTime] = useState<WatchTimes>(
		WatchTimes.JustCompletedNow,
	);
	const deployBulkMetadataProgressUpdate = useDeployBulkMetadataProgressUpdate(
		metadataDetails.title,
	);

	const handleSubmit = async () => {
		const startDateFormatted = convertTimestampToUtcString(startDate);
		const finishDateFormatted = convertTimestampToUtcString(finishDate);
		const currentDateFormatted = convertTimestampToUtcString(new Date());
		const common: MetadataProgressUpdateCommonInput = {
			showSeasonNumber: metadataToUpdate.showSeasonNumber,
			mangaVolumeNumber: metadataToUpdate.mangaVolumeNumber,
			showEpisodeNumber: metadataToUpdate.showEpisodeNumber,
			providerWatchedOn: metadataToUpdate.providerWatchedOn,
			mangaChapterNumber: metadataToUpdate.mangaChapterNumber,
			animeEpisodeNumber: metadataToUpdate.animeEpisodeNumber,
			podcastEpisodeNumber: metadataToUpdate.podcastEpisodeNumber,
		};
		const updates = new Array<MetadataProgressUpdateInput>();

		processBulkUpdates({
			history,
			watchTime,
			common,
			updates,
			metadataToUpdate,
			metadataDetails,
			currentDateFormatted,
			selectedDateFormatted: finishDateFormatted,
		});

		const change: MetadataProgressUpdateChange = match(watchTime)
			.with(WatchTimes.JustStartedIt, () => ({
				createNewInProgress: {
					...common,
					startedOn: currentDateFormatted,
				},
			}))
			.with(WatchTimes.JustCompletedNow, () => ({
				createNewCompleted: {
					finishedOnDate: {
						...common,
						timestamp: currentDateFormatted,
					},
				},
			}))
			.with(WatchTimes.CustomDates, () => {
				if (startDateFormatted && finishDateFormatted) {
					return {
						createNewCompleted: {
							startedAndFinishedOnDate: {
								...common,
								startedOn: startDateFormatted,
								timestamp: finishDateFormatted,
							},
						},
					};
				}
				if (startDateFormatted) {
					return {
						createNewCompleted: {
							startedOnDate: {
								...common,
								timestamp: startDateFormatted,
							},
						},
					};
				}
				if (finishDateFormatted) {
					return {
						createNewCompleted: {
							finishedOnDate: {
								...common,
								timestamp: finishDateFormatted,
							},
						},
					};
				}
				throw new Error("At least one date must be provided for CustomDates");
			})
			.with(WatchTimes.IDontRemember, () => ({
				createNewCompleted: { withoutDates: common },
			}))
			.exhaustive();

		updates.push({
			change,
			metadataId: metadataToUpdate.metadataId,
		});
		await deployBulkMetadataProgressUpdate.mutateAsync(updates);
		onSubmit();
	};

	const handleWatchTimeChange = (newWatchTime: WatchTimes) => {
		setWatchTime(newWatchTime);
		match(newWatchTime)
			.with(WatchTimes.JustCompletedNow, () => {
				setStartDate(null);
				setFinishDate(new Date());
			})
			.with(
				WatchTimes.IDontRemember,
				WatchTimes.CustomDates,
				WatchTimes.JustStartedIt,
				() => {
					setStartDate(null);
					setFinishDate(null);
				},
			)
			.run();
	};

	const handleProviderChange = (provider: string | null) => {
		setMetadataToUpdate(
			produce(metadataToUpdate, (draft) => {
				draft.providerWatchedOn = provider;
			}),
		);
	};

	return (
		<Stack ref={parent}>
			<AnimeForm
				metadataDetails={metadataDetails}
				metadataToUpdate={metadataToUpdate}
				setMetadataToUpdate={setMetadataToUpdate}
			/>
			<MangaForm
				metadataDetails={metadataDetails}
				metadataToUpdate={metadataToUpdate}
				setMetadataToUpdate={setMetadataToUpdate}
			/>
			<ShowForm
				metadataDetails={metadataDetails}
				metadataToUpdate={metadataToUpdate}
				setMetadataToUpdate={setMetadataToUpdate}
			/>
			<PodcastForm
				metadataDetails={metadataDetails}
				metadataToUpdate={metadataToUpdate}
				setMetadataToUpdate={setMetadataToUpdate}
			/>
			<WatchTimeSelect
				value={watchTime}
				onChange={handleWatchTimeChange}
				metadataLot={metadataDetails.lot}
			/>
			{watchTime === WatchTimes.CustomDates ? (
				<CustomDatePicker
					startDate={startDate}
					finishDate={finishDate}
					onStartDateChange={setStartDate}
					onFinishDateChange={setFinishDate}
				/>
			) : null}
			{watchTime !== WatchTimes.JustStartedIt ? (
				<ProviderSelect
					metadataLot={metadataDetails.lot}
					onChange={handleProviderChange}
				/>
			) : null}
			<SubmitButton
				onClick={handleSubmit}
				disabled={
					watchTime === WatchTimes.CustomDates &&
					startDate === null &&
					finishDate === null
				}
			/>
		</Stack>
	);
};
