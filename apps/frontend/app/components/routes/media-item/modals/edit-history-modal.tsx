import {
	Button,
	FocusTrap,
	Group,
	Input,
	Modal,
	MultiSelect,
	NumberInput,
	Select,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	MediaLot,
	SeenState,
	UpdateSeenItemDocument,
	type UpdateSeenItemInput,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation } from "@tanstack/react-query";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useCoreDetails,
	useGetWatchProviders,
	useMetadataDetails,
	useUserDetails,
	useUserMetadataDetails,
} from "~/lib/shared/hooks";
import { getVerb } from "~/lib/shared/media-utils";
import {
	clientGqlService,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import { Verb } from "~/lib/types";
import {
	type DurationInput,
	type History,
	POSSIBLE_DURATION_UNITS,
} from "../types";
import { convertDurationToSeconds, convertSecondsToDuration } from "../utils";

interface EditSeenItemFormValues {
	startedOn: Date | null;
	finishedOn: Date | null;
	showSeasonNumber: string | null;
	showEpisodeNumber: string | null;
	animeEpisodeNumber: number | string;
	mangaChapterNumber: number | string;
	mangaVolumeNumber: number | string;
	podcastEpisodeNumber: string | null;
	providersConsumedOn: string[];
	reviewId: string | null;
	manualTimeSpent: DurationInput;
}

export const EditHistoryItemModal = (props: {
	seen: History;
	opened: boolean;
	metadataId: string;
	onClose: () => void;
}) => {
	const userDetails = useUserDetails();
	const coreDetails = useCoreDetails();
	const [{ data: metadataDetails }] = useMetadataDetails(props.metadataId);
	const watchProviders = useGetWatchProviders(metadataDetails?.lot);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);

	const form = useForm<EditSeenItemFormValues>({
		initialValues: {
			startedOn: props.seen.startedOn ? new Date(props.seen.startedOn) : null,
			finishedOn: props.seen.finishedOn
				? new Date(props.seen.finishedOn)
				: null,
			showSeasonNumber:
				props.seen.showExtraInformation?.season !== undefined
					? String(props.seen.showExtraInformation.season)
					: null,
			showEpisodeNumber:
				props.seen.showExtraInformation?.episode !== undefined
					? String(props.seen.showExtraInformation.episode)
					: null,
			animeEpisodeNumber: props.seen.animeExtraInformation?.episode ?? "",
			mangaChapterNumber: props.seen.mangaExtraInformation?.chapter ?? "",
			mangaVolumeNumber: props.seen.mangaExtraInformation?.volume ?? "",
			podcastEpisodeNumber:
				props.seen.podcastExtraInformation?.episode !== undefined
					? String(props.seen.podcastExtraInformation.episode)
					: null,
			providersConsumedOn: props.seen.providersConsumedOn || [],
			reviewId: props.seen.reviewId ?? null,
			manualTimeSpent: convertSecondsToDuration(props.seen.manualTimeSpent),
		},
	});

	const editSeenItemMutation = useMutation({
		mutationFn: async (input: UpdateSeenItemInput) => {
			await clientGqlService.request(UpdateSeenItemDocument, { input });
		},
		onSuccess: () => {
			notifications.show({
				color: "green",
				message: "Edited history item successfully",
			});
			props.onClose();
			refreshEntityDetails(props.metadataId);
		},
	});

	const manualTimeSpentInSeconds = convertDurationToSeconds(
		form.values.manualTimeSpent,
	);
	const reviewsByThisCurrentUser = (userMetadataDetails?.reviews ?? []).filter(
		(r) => r.postedBy.id === userDetails.id,
	);
	const areStartAndEndInputsDisabled = ![
		SeenState.Completed,
		SeenState.Dropped,
	].includes(props.seen.state);

	const seasons = metadataDetails?.showSpecifics?.seasons ?? [];
	const selectedSeason = seasons.find(
		(s) => String(s.seasonNumber) === form.values.showSeasonNumber,
	);
	const episodes = selectedSeason?.episodes ?? [];
	const podcastEpisodes = metadataDetails?.podcastSpecifics?.episodes ?? [];

	if (!metadataDetails) return null;

	return (
		<Modal
			centered
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
		>
			<FocusTrap.InitialFocus />
			<form
				onSubmit={form.onSubmit((values) => {
					editSeenItemMutation.mutate({
						seenId: props.seen.id,
						reviewId: values.reviewId || "",
						manualTimeSpent:
							manualTimeSpentInSeconds > 0
								? String(manualTimeSpentInSeconds)
								: undefined,
						startedOn: values.startedOn
							? values.startedOn.toISOString()
							: undefined,
						finishedOn: values.finishedOn
							? values.finishedOn.toISOString()
							: undefined,
						showSeasonNumber: values.showSeasonNumber
							? Number(values.showSeasonNumber)
							: undefined,
						showEpisodeNumber: values.showEpisodeNumber
							? Number(values.showEpisodeNumber)
							: undefined,
						animeEpisodeNumber: values.animeEpisodeNumber
							? Number(values.animeEpisodeNumber)
							: undefined,
						mangaChapterNumber: values.mangaChapterNumber
							? String(values.mangaChapterNumber)
							: undefined,
						mangaVolumeNumber: values.mangaVolumeNumber
							? Number(values.mangaVolumeNumber)
							: undefined,
						podcastEpisodeNumber: values.podcastEpisodeNumber
							? Number(values.podcastEpisodeNumber)
							: undefined,
						providersConsumedOn: values.providersConsumedOn,
					});
				})}
			>
				<Stack>
					<Title order={3}>Edit history record</Title>
					<DateTimePicker
						label="Start Date & Time"
						disabled={areStartAndEndInputsDisabled}
						{...form.getInputProps("startedOn")}
					/>
					<DateTimePicker
						label="End Date & Time"
						disabled={areStartAndEndInputsDisabled}
						{...form.getInputProps("finishedOn")}
					/>
					{metadataDetails.lot === MediaLot.Show && seasons.length > 0 ? (
						<>
							<Select
								label="Season"
								data={seasons.map((s) => ({
									label: s.name,
									value: String(s.seasonNumber),
								}))}
								{...form.getInputProps("showSeasonNumber")}
							/>
							<Select
								label="Episode"
								data={episodes.map((e) => ({
									value: String(e.episodeNumber),
									label: `${e.episodeNumber}. ${e.name}`,
								}))}
								{...form.getInputProps("showEpisodeNumber")}
							/>
						</>
					) : null}
					{metadataDetails.lot === MediaLot.Anime ? (
						<NumberInput
							label="Episode"
							{...form.getInputProps("animeEpisodeNumber")}
						/>
					) : null}
					{metadataDetails.lot === MediaLot.Manga ? (
						<>
							<NumberInput
								label="Chapter"
								decimalScale={2}
								{...form.getInputProps("mangaChapterNumber")}
							/>
							<NumberInput
								label="Volume"
								{...form.getInputProps("mangaVolumeNumber")}
							/>
						</>
					) : null}
					{metadataDetails.lot === MediaLot.Podcast &&
					podcastEpisodes.length > 0 ? (
						<Select
							label="Episode"
							data={podcastEpisodes.map((e) => ({
								value: String(e.number),
								label: `${e.number}. ${e.title}`,
							}))}
							{...form.getInputProps("podcastEpisodeNumber")}
						/>
					) : null}
					<MultiSelect
						data={watchProviders}
						nothingFoundMessage="No watch providers configured. Please add them in your general preferences."
						label={`Where did you ${getVerb(
							Verb.Read,
							metadataDetails.lot,
						)} it?`}
						{...form.getInputProps("providersConsumedOn")}
					/>
					<Tooltip
						label={PRO_REQUIRED_MESSAGE}
						disabled={coreDetails.isServerKeyValidated}
					>
						<Select
							clearable
							limit={5}
							searchable
							label="Associate with a review"
							disabled={!coreDetails.isServerKeyValidated}
							data={reviewsByThisCurrentUser.map((r) => ({
								value: r.id,
								label: [
									r.textOriginal
										? `${r.textOriginal.slice(0, 20)}...`
										: undefined,
									r.rating,
									`(${r.id})`,
								]
									.filter(Boolean)
									.join(" • "),
							}))}
							{...form.getInputProps("reviewId")}
						/>
					</Tooltip>
					<Input.Wrapper
						label="Time spent"
						description="How much time did you actually spend on this media?"
					>
						<Tooltip
							label={PRO_REQUIRED_MESSAGE}
							disabled={coreDetails.isServerKeyValidated}
						>
							<Group wrap="nowrap" mt="xs">
								{POSSIBLE_DURATION_UNITS.map((unit) => (
									<NumberInput
										key={unit}
										rightSectionWidth={36}
										disabled={!coreDetails.isServerKeyValidated}
										rightSection={<Text size="xs">{unit}</Text>}
										value={form.values.manualTimeSpent[unit]}
										onChange={(v) =>
											form.setFieldValue("manualTimeSpent", {
												...form.values.manualTimeSpent,
												[unit]: v,
											})
										}
									/>
								))}
							</Group>
						</Tooltip>
					</Input.Wrapper>
					<Button
						variant="outline"
						type="submit"
						loading={editSeenItemMutation.isPending}
					>
						Submit
					</Button>
				</Stack>
			</form>
		</Modal>
	);
};
