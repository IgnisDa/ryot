import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	Button,
	Center,
	Checkbox,
	Flex,
	Group,
	Input,
	Loader,
	NumberInput,
	Select,
	Slider,
	Stack,
	Text,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import {
	MediaLot,
	type MetadataDetailsQuery,
	type MetadataProgressUpdateChange,
	type MetadataProgressUpdateCommonInput,
	type MetadataProgressUpdateInput,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber } from "@ryot/ts-utils";
import {
	IconBook,
	IconBrandPagekit,
	IconClock,
	IconDeviceTv,
	IconPercentage,
} from "@tabler/icons-react";
import { produce } from "immer";
import { useState } from "react";
import { match } from "ts-pattern";
import { Verb, convertTimestampToUtcString, getVerb } from "~/lib/common";
import {
	useDeployBulkMetadataProgressUpdate,
	useGetWatchProviders,
	useMetadataDetails,
	useUserMetadataDetails,
} from "~/lib/hooks";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import {
	type UpdateProgressData,
	useMetadataProgressUpdate,
} from "~/lib/state/media";
import type { History, InProgress } from "../types";
import { WatchTimes } from "../types";

export const MetadataProgressUpdateForm = ({
	closeMetadataProgressUpdateModal,
}: {
	closeMetadataProgressUpdateModal: () => void;
}) => {
	const [metadataToUpdate] = useMetadataProgressUpdate();

	const { data: metadataDetails } = useMetadataDetails(
		metadataToUpdate?.metadataId,
	);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		metadataToUpdate?.metadataId,
	);

	if (!metadataDetails || !metadataToUpdate || !userMetadataDetails)
		return (
			<Center p="lg">
				<Loader type="dots" />
			</Center>
		);

	const onSubmit = () => {
		closeMetadataProgressUpdateModal();
	};

	return userMetadataDetails.inProgress ? (
		<MetadataInProgressUpdateForm
			onSubmit={onSubmit}
			metadataDetails={metadataDetails}
			metadataToUpdate={metadataToUpdate}
			inProgress={userMetadataDetails.inProgress}
		/>
	) : (
		<MetadataNewProgressUpdateForm
			onSubmit={onSubmit}
			metadataDetails={metadataDetails}
			metadataToUpdate={metadataToUpdate}
			history={userMetadataDetails.history}
		/>
	);
};

const MetadataInProgressUpdateForm = ({
	onSubmit,
	inProgress,
	metadataDetails,
	metadataToUpdate,
}: {
	onSubmit: () => void;
	inProgress: NonNullable<InProgress>;
	metadataToUpdate: UpdateProgressData;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}) => {
	const deployBulkMetadataProgressUpdate = useDeployBulkMetadataProgressUpdate(
		metadataDetails.title,
	);

	const total =
		metadataDetails.audioBookSpecifics?.runtime ||
		metadataDetails.bookSpecifics?.pages ||
		metadataDetails.movieSpecifics?.runtime ||
		metadataDetails.mangaSpecifics?.chapters ||
		metadataDetails.animeSpecifics?.episodes ||
		metadataDetails.visualNovelSpecifics?.length;
	const progress = Number(inProgress.progress);
	const [value, setValue] = useState<number | undefined>(progress);

	const [updateIcon, text] = match(metadataDetails.lot)
		.with(MediaLot.Book, () => [<IconBook size={24} key="element" />, "Pages"])
		.with(MediaLot.Anime, () => [
			<IconDeviceTv size={24} key="element" />,
			"Episodes",
		])
		.with(MediaLot.Manga, () => [
			<IconBrandPagekit size={24} key="element" />,
			"Chapters",
		])
		.with(MediaLot.Movie, MediaLot.VisualNovel, MediaLot.AudioBook, () => [
			<IconClock size={24} key="element" />,
			"Minutes",
		])
		.otherwise(() => [null, null]);

	return (
		<Stack mt="sm">
			<Group>
				<Slider
					min={0}
					step={1}
					max={100}
					value={value}
					onChange={setValue}
					style={{ flexGrow: 1 }}
					showLabelOnHover={false}
				/>
				<NumberInput
					w="20%"
					min={0}
					step={1}
					max={100}
					hideControls
					value={value}
					onFocus={(e) => e.target.select()}
					rightSection={<IconPercentage size={16} />}
					onChange={(v) => {
						if (isNumber(v)) setValue(v);
						else setValue(undefined);
					}}
				/>
			</Group>
			{total ? (
				<>
					<Text ta="center" fw="bold">
						OR
					</Text>
					<Flex align="center" gap="xs">
						<NumberInput
							min={0}
							step={1}
							flex={1}
							hideControls
							leftSection={updateIcon}
							max={Number(total)}
							onFocus={(e) => e.target.select()}
							defaultValue={((Number(total) || 1) * (value || 1)) / 100}
							onChange={(v) => {
								const value = (Number(v) / (Number(total) || 1)) * 100;
								setValue(value);
							}}
						/>
						<Text>{text}</Text>
					</Flex>
				</>
			) : null}
			<Button
				variant="outline"
				type="submit"
				onClick={async () => {
					await deployBulkMetadataProgressUpdate.mutateAsync([
						{
							metadataId: metadataToUpdate.metadataId,
							change: {
								changeLatestInProgress: { progress: value?.toString() },
							},
						},
					]);
					onSubmit();
				}}
			>
				Update
			</Button>
		</Stack>
	);
};

const MetadataNewProgressUpdateForm = ({
	history,
	onSubmit,
	metadataDetails,
	metadataToUpdate,
}: {
	history: History;
	onSubmit: () => void;
	metadataToUpdate: UpdateProgressData;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}) => {
	const [parent] = useAutoAnimate();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
	const [watchTime, setWatchTime] = useState<WatchTimes>(
		WatchTimes.JustCompletedNow,
	);
	const watchProviders = useGetWatchProviders(metadataDetails.lot);
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const deployBulkMetadataProgressUpdate = useDeployBulkMetadataProgressUpdate(
		metadataDetails.title,
	);

	return (
		<Stack ref={parent}>
			{metadataDetails.lot === MediaLot.Anime ? (
				<>
					<NumberInput
						required
						hideControls
						label="Episode"
						value={metadataToUpdate.animeEpisodeNumber?.toString()}
						onChange={(e) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.animeEpisodeNumber = Number(e);
								}),
							);
						}}
					/>
					<Checkbox
						label="Mark all unseen episodes before this as watched"
						defaultChecked={metadataToUpdate.animeAllEpisodesBefore}
						onChange={(e) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.animeAllEpisodesBefore = e.target.checked;
								}),
							);
						}}
					/>
				</>
			) : null}
			{metadataDetails.lot === MediaLot.Manga ? (
				<>
					<Input.Wrapper
						required
						label="Enter either the chapter number or the volume number"
					>
						<Group wrap="nowrap">
							<NumberInput
								hideControls
								description="Chapter"
								value={metadataToUpdate.mangaChapterNumber?.toString()}
								onChange={(e) => {
									setMetadataToUpdate(
										produce(metadataToUpdate, (draft) => {
											draft.mangaChapterNumber =
												e === "" ? undefined : Number(e).toString();
										}),
									);
								}}
							/>
							<Text ta="center" fw="bold" mt="sm">
								OR
							</Text>
							<NumberInput
								hideControls
								description="Volume"
								value={metadataToUpdate.mangaVolumeNumber?.toString()}
								onChange={(e) => {
									setMetadataToUpdate(
										produce(metadataToUpdate, (draft) => {
											draft.mangaVolumeNumber =
												e === "" ? undefined : Number(e);
										}),
									);
								}}
							/>
						</Group>
					</Input.Wrapper>
					<Checkbox
						label="Mark all unread volumes/chapters before this as watched"
						defaultChecked={metadataToUpdate.mangaAllChaptersOrVolumesBefore}
						onChange={(e) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.mangaAllChaptersOrVolumesBefore = e.target.checked;
								}),
							);
						}}
					/>
				</>
			) : null}
			{metadataDetails.lot === MediaLot.Show ? (
				<>
					<Select
						required
						searchable
						limit={50}
						label="Season"
						value={metadataToUpdate.showSeasonNumber?.toString()}
						data={metadataDetails.showSpecifics?.seasons.map((s) => ({
							label: `${s.seasonNumber}. ${s.name.toString()}`,
							value: s.seasonNumber.toString(),
						}))}
						onChange={(v) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.showSeasonNumber = Number(v);
								}),
							);
						}}
					/>
					<Select
						searchable
						limit={50}
						required
						label="Episode"
						value={metadataToUpdate.showEpisodeNumber?.toString()}
						onChange={(v) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.showEpisodeNumber = Number(v);
								}),
							);
						}}
						data={
							metadataDetails.showSpecifics?.seasons
								.find(
									(s) => s.seasonNumber === metadataToUpdate.showSeasonNumber,
								)
								?.episodes.map((e) => ({
									label: `${e.episodeNumber}. ${e.name.toString()}`,
									value: e.episodeNumber.toString(),
								})) || []
						}
					/>
					<Checkbox
						label="Mark all unseen episodes before this as seen"
						defaultChecked={metadataToUpdate.showAllEpisodesBefore}
						onChange={(e) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.showAllEpisodesBefore = e.target.checked;
								}),
							);
						}}
					/>
				</>
			) : null}
			{metadataDetails.lot === MediaLot.Podcast ? (
				<>
					<Text fw="bold">Select episode</Text>
					<Select
						required
						limit={50}
						searchable
						label="Episode"
						value={metadataToUpdate.podcastEpisodeNumber?.toString()}
						data={metadataDetails.podcastSpecifics?.episodes.map((se) => ({
							label: se.title.toString(),
							value: se.number.toString(),
						}))}
						onChange={(v) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.podcastEpisodeNumber = Number(v);
								}),
							);
						}}
					/>
					<Checkbox
						label="Mark all unseen episodes before this as seen"
						defaultChecked={metadataToUpdate.podcastAllEpisodesBefore}
						onChange={(e) => {
							setMetadataToUpdate(
								produce(metadataToUpdate, (draft) => {
									draft.podcastAllEpisodesBefore = e.target.checked;
								}),
							);
						}}
					/>
				</>
			) : null}
			<Select
				value={watchTime}
				label={`When did you ${getVerb(Verb.Read, metadataDetails.lot)} it?`}
				data={Object.values(WatchTimes).filter((v) =>
					[
						MediaLot.Show,
						MediaLot.Podcast,
						MediaLot.Anime,
						MediaLot.Manga,
					].includes(metadataDetails.lot)
						? v !== WatchTimes.JustStartedIt
						: true,
				)}
				onChange={(v) => {
					setWatchTime(v as typeof watchTime);
					match(v)
						.with(WatchTimes.JustCompletedNow, () =>
							setSelectedDate(new Date()),
						)
						.with(
							WatchTimes.IDontRemember,
							WatchTimes.CustomDate,
							WatchTimes.JustStartedIt,
							() => setSelectedDate(null),
						)
						.run();
				}}
			/>
			{watchTime === WatchTimes.CustomDate ? (
				<DateTimePicker
					required
					clearable
					dropdownType="modal"
					maxDate={new Date()}
					label="Enter exact date"
					onChange={(e) => setSelectedDate(e ? new Date(e) : null)}
				/>
			) : null}
			{watchTime !== WatchTimes.JustStartedIt ? (
				<Select
					data={watchProviders}
					name="providerWatchedOn"
					label={`Where did you ${getVerb(Verb.Read, metadataDetails.lot)} it?`}
					onChange={(v) => {
						setMetadataToUpdate(
							produce(metadataToUpdate, (draft) => {
								draft.providerWatchedOn = v;
							}),
						);
					}}
				/>
			) : null}
			<Button
				variant="outline"
				disabled={selectedDate === null}
				className={OnboardingTourStepTargets.AddMovieToWatchedHistory}
				onClick={async () => {
					const selectedDateFormatted =
						convertTimestampToUtcString(selectedDate);
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

					// Handle bulk updates for previous media
					const latestHistoryItem = history[0];

					// For Anime: generate updates for all episodes before the current one
					if (
						metadataDetails.lot === MediaLot.Anime &&
						metadataToUpdate.animeAllEpisodesBefore &&
						metadataToUpdate.animeEpisodeNumber
					) {
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
									.with(WatchTimes.CustomDate, () => {
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
					} // For Manga: generate updates for volumes or chapters
					if (
						metadataDetails.lot === MediaLot.Manga &&
						metadataToUpdate.mangaAllChaptersOrVolumesBefore
					) {
						const isValidNumber = (value: unknown): boolean => {
							const num = Number(value);
							return !Number.isNaN(num) && Number.isFinite(num);
						};

						// Check if exactly one of volume or chapter is provided
						const hasValidChapter = isValidNumber(
							metadataToUpdate.mangaChapterNumber,
						);
						const hasValidVolume = isValidNumber(
							metadataToUpdate.mangaVolumeNumber,
						);

						if (
							(hasValidChapter && hasValidVolume) ||
							(!hasValidChapter && !hasValidVolume)
						) {
							return notifications.show({
								color: "red",
								message:
									"Exactly one of mangaChapterNumber or mangaVolumeNumber must be provided",
							});
						}
						// If volume number is provided
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
										.with(WatchTimes.CustomDate, () => {
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

						// If chapter number is provided
						if (metadataToUpdate.mangaChapterNumber) {
							const targetChapter = Number(metadataToUpdate.mangaChapterNumber);
							const markedChapters = new Set();

							// Collect already marked chapters
							for (const historyItem of history) {
								const chapter = Number(
									historyItem?.mangaExtraInformation?.chapter,
								);
								if (!Number.isNaN(chapter) && chapter < targetChapter) {
									markedChapters.add(chapter);
								}
							}

							// Add updates for unmarked chapters
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
											.with(WatchTimes.CustomDate, () => {
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

					// For Shows: generate updates for all episodes before the current one
					if (
						metadataDetails.lot === MediaLot.Show &&
						metadataToUpdate.showAllEpisodesBefore &&
						metadataToUpdate.showSeasonNumber &&
						metadataToUpdate.showEpisodeNumber
					) {
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
							for (
								let i = firstEpisodeIndexToMark;
								i < selectedEpisodeIndex;
								i++
							) {
								const currentEpisode = allEpisodesInShow[i];
								// Skip specials if the selected episode is not a special
								if (
									currentEpisode.seasonNumber === 0 &&
									selectedEpisode.seasonNumber !== 0
								) {
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
										.with(WatchTimes.CustomDate, () => {
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

					// For Podcasts: generate updates for all episodes before the current one
					if (
						metadataDetails.lot === MediaLot.Podcast &&
						metadataToUpdate.podcastAllEpisodesBefore &&
						metadataToUpdate.podcastEpisodeNumber
					) {
						const podcastSpecifics =
							metadataDetails.podcastSpecifics?.episodes || [];
						const selectedEpisode = podcastSpecifics.find(
							(e) => e.number === metadataToUpdate.podcastEpisodeNumber,
						);

						if (selectedEpisode) {
							const lastSeenEpisode =
								latestHistoryItem?.podcastExtraInformation?.episode || 0;

							const allUnseenEpisodesBefore = podcastSpecifics.filter(
								(e) =>
									e.number < selectedEpisode.number &&
									e.number > lastSeenEpisode,
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
										.with(WatchTimes.CustomDate, () => {
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

					// Add the current item
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
						.with(WatchTimes.CustomDate, () => {
							if (!selectedDateFormatted)
								throw new Error("Selected date is undefined");

							return {
								createNewCompleted: {
									finishedOnDate: {
										...common,
										timestamp: selectedDateFormatted,
									},
								},
							};
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
					advanceOnboardingTourStep();
					onSubmit();
				}}
			>
				Submit
			</Button>
		</Stack>
	);
};
