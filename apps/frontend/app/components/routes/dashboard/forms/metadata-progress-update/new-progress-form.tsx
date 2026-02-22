import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Button, Stack } from "@mantine/core";
import type {
	MetadataProgressUpdateChange,
	MetadataProgressUpdateCommonInput,
	MetadataProgressUpdateInput,
} from "@ryot/generated/graphql/backend/graphql";
import { match } from "ts-pattern";
import { useSavedForm } from "~/lib/hooks/use-saved-form";
import { convertTimestampToUtcString } from "~/lib/shared/date-utils";
import {
	useDeployBulkMetadataProgressUpdateMutation,
	useMetadataDetails,
} from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import {
	OnboardingTourStepTarget,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
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

export const MetadataNewProgressUpdateForm = (
	props: MetadataNewProgressFormProps,
) => {
	const [parent] = useAutoAnimate();
	const { metadataToUpdate, updateMetadataToUpdate } =
		useMetadataProgressUpdate();
	const [{ data: metadataDetails }] = useMetadataDetails(props.metadataId);
	const deployBulkMetadataProgressUpdate =
		useDeployBulkMetadataProgressUpdateMutation(metadataDetails?.title);
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const form = useSavedForm<{
		watchTime: WatchTimes;
		startDate: Date | null;
		finishDate: Date | null;
		providersConsumedOn: string[];
	}>({
		storageKeyPrefix: `MetadataNewProgressUpdateForm-${props.metadataId}`,
		initialValues: {
			startDate: null,
			finishDate: new Date(),
			watchTime: WatchTimes.JustCompletedNow,
			providersConsumedOn: metadataToUpdate?.providersConsumedOn || [],
		},
		validate: {
			startDate: (value, values) =>
				values.watchTime === WatchTimes.CustomDates &&
				value === null &&
				values.finishDate === null
					? "Please select at least one date"
					: null,
			finishDate: (value, values) =>
				values.watchTime === WatchTimes.CustomDates &&
				value === null &&
				values.startDate === null
					? "Please select at least one date"
					: null,
		},
	});

	const handleWatchTimeChange = (newWatchTime: WatchTimes) => {
		form.setFieldValue("watchTime", newWatchTime);
		match(newWatchTime)
			.with(WatchTimes.JustCompletedNow, () => {
				form.setFieldValue("startDate", null);
				form.setFieldValue("finishDate", new Date());
			})
			.with(
				WatchTimes.CustomDates,
				WatchTimes.IDontRemember,
				WatchTimes.JustStartedIt,
				() => {
					form.setFieldValue("startDate", null);
					form.setFieldValue("finishDate", null);
				},
			)
			.run();
	};

	if (!metadataToUpdate || !metadataDetails) return null;

	const handleProviderChange = (providers: string[]) => {
		form.setFieldValue("providersConsumedOn", providers);
		updateMetadataToUpdate({
			...metadataToUpdate,
			providersConsumedOn: [...providers],
		});
	};

	return (
		<form
			onSubmit={form.onSubmit(async (values) => {
				const startDateFormatted = convertTimestampToUtcString(
					values.startDate,
				);
				const finishDateFormatted = convertTimestampToUtcString(
					values.finishDate,
				);
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
				const updates: MetadataProgressUpdateInput[] = [];

				processBulkUpdates({
					common,
					updates,
					metadataToUpdate,
					startDateFormatted,
					finishDateFormatted,
					currentDateFormatted,
					history: props.history,
					metadata: metadataDetails,
					watchTime: values.watchTime,
				});

				const change: MetadataProgressUpdateChange = match(values.watchTime)
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
				advanceOnboardingTourStep();
				form.clearSavedState();
				props.onSubmit();
			})}
		>
			<Stack ref={parent} gap="sm">
				<ShowForm metadataId={props.metadataId} />
				<AnimeForm metadataId={props.metadataId} />
				<MangaForm metadataId={props.metadataId} />
				<PodcastForm metadataId={props.metadataId} />
				<WatchTimeSelect
					value={form.values.watchTime}
					onChange={handleWatchTimeChange}
					metadataLot={metadataDetails.lot}
				/>
				{form.values.watchTime === WatchTimes.CustomDates ? (
					<CustomDatePicker
						startDate={form.values.startDate}
						finishDate={form.values.finishDate}
						onStartDateChange={(date) => form.setFieldValue("startDate", date)}
						onFinishDateChange={(date) =>
							form.setFieldValue("finishDate", date)
						}
					/>
				) : null}
				{form.values.watchTime !== WatchTimes.JustStartedIt ? (
					<ProviderSelect
						onChange={handleProviderChange}
						metadataLot={metadataDetails.lot}
						value={form.values.providersConsumedOn}
					/>
				) : null}
				<Button
					size="xs"
					type="submit"
					variant="outline"
					className={OnboardingTourStepTarget.AddAudiobookToWatchedHistory}
					loading={deployBulkMetadataProgressUpdate.isPending}
				>
					Submit
				</Button>
			</Stack>
		</form>
	);
};
