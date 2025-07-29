import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Button, Stack } from "@mantine/core";
import type {
	MetadataProgressUpdateChange,
	MetadataProgressUpdateCommonInput,
	MetadataProgressUpdateInput,
} from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import { useState } from "react";
import { match } from "ts-pattern";
import { convertTimestampToUtcString } from "~/lib/shared/date-utils";
import { useDeployBulkMetadataProgressUpdateMutation } from "~/lib/shared/hooks";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import { WatchTimes } from "../../types";
import { AnimeForm } from "./media-types/anime-form";
import { MangaForm } from "./media-types/manga-form";
import { PodcastForm } from "./media-types/podcast-form";
import { ShowForm } from "./media-types/show-form";
import {
	createCustomDatesCompletedChange,
	processBulkUpdates,
} from "./utils/bulk-update-handlers";
import {
	CustomDatePicker,
	ProviderSelect,
	WatchTimeSelect,
} from "./utils/common-elements";
import type { MetadataNewProgressFormProps } from "./utils/form-types";

export const MetadataNewProgressUpdateForm = ({
	history,
	onSubmit,
	metadataDetails,
}: MetadataNewProgressFormProps) => {
	const [parent] = useAutoAnimate();
	const { metadataToUpdate, setMetadataToUpdate } = useMetadataProgressUpdate();
	const [startDate, setStartDate] = useState<Date | null>(null);
	const [finishDate, setFinishDate] = useState<Date | null>(new Date());
	const [watchTime, setWatchTime] = useState<WatchTimes>(
		WatchTimes.JustCompletedNow,
	);
	const deployBulkMetadataProgressUpdate =
		useDeployBulkMetadataProgressUpdateMutation(metadataDetails.title);
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const handleSubmit = async () => {
		if (!metadataToUpdate) return;

		const startDateFormatted = convertTimestampToUtcString(startDate);
		const finishDateFormatted = convertTimestampToUtcString(finishDate);
		const currentDateFormatted = convertTimestampToUtcString(new Date());
		const common: MetadataProgressUpdateCommonInput = {
			showSeasonNumber: metadataToUpdate.showSeasonNumber,
			mangaVolumeNumber: metadataToUpdate.mangaVolumeNumber,
			showEpisodeNumber: metadataToUpdate.showEpisodeNumber,
			providersConsumedOn: metadataToUpdate.providersConsumedOn,
			mangaChapterNumber: metadataToUpdate.mangaChapterNumber,
			animeEpisodeNumber: metadataToUpdate.animeEpisodeNumber,
			podcastEpisodeNumber: metadataToUpdate.podcastEpisodeNumber,
		};
		const updates = new Array<MetadataProgressUpdateInput>();

		processBulkUpdates({
			common,
			history,
			updates,
			watchTime,
			metadataDetails,
			metadataToUpdate,
			startDateFormatted,
			finishDateFormatted,
			currentDateFormatted,
		});

		const change: MetadataProgressUpdateChange = match(watchTime)
			.with(WatchTimes.IDontRemember, () => ({
				createNewCompleted: { withoutDates: common },
			}))
			.with(WatchTimes.JustStartedIt, () => ({
				createNewInProgress: { ...common, startedOn: currentDateFormatted },
			}))
			.with(WatchTimes.JustCompletedNow, () => ({
				createNewCompleted: {
					finishedOnDate: { ...common, timestamp: currentDateFormatted },
				},
			}))
			.with(WatchTimes.CustomDates, () =>
				createCustomDatesCompletedChange({
					startDateFormatted,
					finishDateFormatted,
					commonFields: common,
				}),
			)
			.exhaustive();

		updates.push({ change, metadataId: metadataToUpdate.metadataId });
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
				WatchTimes.CustomDates,
				WatchTimes.IDontRemember,
				WatchTimes.JustStartedIt,
				() => {
					setStartDate(null);
					setFinishDate(null);
				},
			)
			.run();
	};

	if (!metadataToUpdate) return null;

	const handleProviderChange = (providers: string[]) => {
		setMetadataToUpdate(
			produce(metadataToUpdate, (draft) => {
				draft.providersConsumedOn = providers;
			}),
		);
	};

	return (
		<Stack ref={parent} gap="sm">
			<ShowForm metadataDetails={metadataDetails} />
			<AnimeForm metadataDetails={metadataDetails} />
			<MangaForm metadataDetails={metadataDetails} />
			<PodcastForm metadataDetails={metadataDetails} />
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
					onChange={handleProviderChange}
					metadataLot={metadataDetails.lot}
					value={metadataToUpdate.providersConsumedOn}
				/>
			) : null}
			<Button
				size="xs"
				variant="outline"
				className={OnboardingTourStepTargets.AddAudiobookToWatchedHistory}
				disabled={
					startDate === null &&
					finishDate === null &&
					watchTime === WatchTimes.CustomDates
				}
				onClick={() => {
					advanceOnboardingTourStep();
					handleSubmit();
				}}
			>
				Submit
			</Button>
		</Stack>
	);
};
