import {
	Box,
	Button,
	Checkbox,
	Flex,
	Group,
	Input,
	NumberInput,
	Rating,
	SegmentedControl,
	Select,
	Stack,
	Text,
	Textarea,
	ThemeIcon,
	rem,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	CreateOrUpdateReviewDocument,
	type CreateOrUpdateReviewInput,
	EntityLot,
	MediaLot,
	UserReviewScale,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import {
	IconMoodEmpty,
	IconMoodHappy,
	IconMoodSad,
	IconPercentage,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { produce } from "immer";
import type { ReactNode } from "react";
import { useState } from "react";
import { useRevalidator } from "react-router";
import { match } from "ts-pattern";
import {
	useApplicationEvents,
	useMetadataDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { convertDecimalToThreePointSmiley } from "~/lib/shared/media-utils";
import {
	clientGqlService,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import { useReviewEntity } from "~/lib/state/media";
import { ThreePointSmileyRating } from "~/lib/types";
import { convertThreePointSmileyToDecimal } from "../utils";

export const ReviewEntityForm = (props: {
	closeReviewEntityModal: () => void;
}) => {
	const revalidator = useRevalidator();
	const userPreferences = useUserPreferences();
	const events = useApplicationEvents();
	const [entityToReview] = useReviewEntity();
	const [ratingInThreePointSmiley, setRatingInThreePointSmiley] = useState<
		ThreePointSmileyRating | undefined
	>(
		entityToReview?.existingReview?.rating
			? convertDecimalToThreePointSmiley(
					Number(entityToReview.existingReview.rating),
				)
			: undefined,
	);
	const [showSeasonNumber, setShowSeasonNumber] = useState<string | undefined>(
		entityToReview?.existingReview?.showExtraInformation?.season?.toString(),
	);
	const [showEpisodeNumber, setShowEpisodeNumber] = useState<
		string | undefined
	>(entityToReview?.existingReview?.showExtraInformation?.episode?.toString());
	const [podcastEpisodeNumber, setPodcastEpisodeNumber] = useState<
		string | undefined
	>(
		entityToReview?.existingReview?.podcastExtraInformation?.episode?.toString(),
	);
	const { data: metadataDetails } = useMetadataDetails(
		entityToReview?.entityId,
		entityToReview?.entityLot === EntityLot.Metadata,
	);

	const [input, setInput] = useState<CreateOrUpdateReviewInput>({
		entityId: entityToReview?.entityId || "",
		reviewId: entityToReview?.existingReview?.id,
		text: entityToReview?.existingReview?.textOriginal || "",
		entityLot: entityToReview?.entityLot || EntityLot.Metadata,
		isSpoiler: entityToReview?.existingReview?.isSpoiler || false,
		visibility: entityToReview?.existingReview?.visibility || Visibility.Public,
		showSeasonNumber:
			entityToReview?.existingReview?.showExtraInformation?.season,
		showEpisodeNumber:
			entityToReview?.existingReview?.showExtraInformation?.episode,
		mangaVolumeNumber:
			entityToReview?.existingReview?.mangaExtraInformation?.volume,
		animeEpisodeNumber:
			entityToReview?.existingReview?.animeExtraInformation?.episode,
		mangaChapterNumber:
			entityToReview?.existingReview?.mangaExtraInformation?.chapter,
		podcastEpisodeNumber:
			entityToReview?.existingReview?.podcastExtraInformation?.episode,
		rating: entityToReview?.existingReview?.rating
			? entityToReview.existingReview.rating
			: undefined,
	});

	const reviewMutation = useMutation({
		mutationFn: () =>
			clientGqlService.request(CreateOrUpdateReviewDocument, { input }),
	});

	const SmileySurround = (props: {
		children: ReactNode;
		smileyRating: ThreePointSmileyRating;
	}) => (
		<ThemeIcon
			size="xl"
			variant={
				props.smileyRating === ratingInThreePointSmiley
					? "outline"
					: "transparent"
			}
			onClick={() => {
				setRatingInThreePointSmiley(props.smileyRating);
				setInput(
					produce(input, (draft) => {
						draft.rating = convertThreePointSmileyToDecimal(
							props.smileyRating,
						).toString();
					}),
				);
			}}
		>
			{props.children}
		</ThemeIcon>
	);

	if (!entityToReview) return null;

	return (
		<Stack>
			<Flex align="center" gap="xl">
				{match(userPreferences.general.reviewScale)
					.with(UserReviewScale.OutOfFive, () => (
						<Flex gap="sm" mt="lg">
							<Input.Label>Rating:</Input.Label>
							<Rating
								fractions={2}
								value={input.rating ? Number(input.rating) : undefined}
								onChange={(v) =>
									setInput(
										produce(input, (draft) => {
											draft.rating = v ? v.toString() : undefined;
										}),
									)
								}
							/>
						</Flex>
					))
					.with(UserReviewScale.OutOfHundred, () => (
						<NumberInput
							w="40%"
							min={0}
							step={1}
							max={100}
							hideControls
							label="Rating"
							rightSection={<IconPercentage size={16} />}
							value={input.rating ? Number(input.rating) : undefined}
							onChange={(v) =>
								setInput(
									produce(input, (draft) => {
										draft.rating = v ? v.toString() : undefined;
									}),
								)
							}
						/>
					))
					.with(UserReviewScale.OutOfTen, () => (
						<NumberInput
							w="40%"
							min={0}
							max={10}
							step={0.1}
							hideControls
							label="Rating"
							rightSectionWidth={rem(60)}
							rightSection={
								<Text size="xs" c="dimmed">
									Out of 10
								</Text>
							}
							value={input.rating ? Number(input.rating) : undefined}
							onChange={(v) =>
								setInput(
									produce(input, (draft) => {
										draft.rating = v ? v.toString() : undefined;
									}),
								)
							}
						/>
					))
					.with(UserReviewScale.ThreePointSmiley, () => (
						<Stack gap={4}>
							<Text size="xs" c="dimmed">
								How did it make you feel?
							</Text>
							<Group justify="space-around">
								<SmileySurround smileyRating={ThreePointSmileyRating.Happy}>
									<IconMoodHappy size={36} />
								</SmileySurround>
								<SmileySurround smileyRating={ThreePointSmileyRating.Neutral}>
									<IconMoodEmpty size={36} />
								</SmileySurround>
								<SmileySurround smileyRating={ThreePointSmileyRating.Sad}>
									<IconMoodSad size={36} />
								</SmileySurround>
							</Group>
						</Stack>
					))
					.exhaustive()}
				<Checkbox
					mt="lg"
					label="This review is a spoiler"
					checked={input.isSpoiler || false}
					onChange={(e) =>
						setInput(
							produce(input, (draft) => {
								draft.isSpoiler = e.currentTarget.checked;
							}),
						)
					}
				/>
			</Flex>
			{entityToReview.metadataLot === MediaLot.Show ? (
				<Stack gap={4}>
					<Select
						size="xs"
						clearable
						searchable
						limit={50}
						label="Season"
						value={showSeasonNumber}
						onChange={(v) => {
							setShowSeasonNumber(v || undefined);
							setShowEpisodeNumber(undefined);
							setInput(
								produce(input, (draft) => {
									draft.showSeasonNumber = v ? Number(v) : undefined;
								}),
							);
						}}
						data={metadataDetails?.showSpecifics?.seasons.map((s) => ({
							label: `${s.seasonNumber}. ${s.name.toString()}`,
							value: s.seasonNumber.toString(),
						}))}
					/>
					<Select
						size="xs"
						clearable
						searchable
						limit={50}
						label="Episode"
						value={showEpisodeNumber}
						onChange={(v) => {
							setShowEpisodeNumber(v || undefined);
							setInput(
								produce(input, (draft) => {
									draft.showEpisodeNumber = v ? Number(v) : undefined;
								}),
							);
						}}
						data={
							metadataDetails?.showSpecifics?.seasons
								.find((s) => s.seasonNumber.toString() === showSeasonNumber)
								?.episodes.map((e) => ({
									label: `${e.episodeNumber}. ${e.name.toString()}`,
									value: e.episodeNumber.toString(),
								})) || []
						}
					/>
				</Stack>
			) : null}
			{entityToReview.metadataLot === MediaLot.Podcast ? (
				<Select
					clearable
					limit={50}
					searchable
					label="Episode"
					value={podcastEpisodeNumber}
					onChange={(v) => {
						setPodcastEpisodeNumber(v || undefined);
						setInput(
							produce(input, (draft) => {
								draft.podcastEpisodeNumber = v ? Number(v) : undefined;
							}),
						);
					}}
					data={metadataDetails?.podcastSpecifics?.episodes.map((se) => ({
						label: se.title.toString(),
						value: se.number.toString(),
					}))}
				/>
			) : null}
			{entityToReview.metadataLot === MediaLot.Anime ? (
				<NumberInput
					hideControls
					label="Episode"
					value={input.animeEpisodeNumber || undefined}
					onChange={(v) =>
						setInput(
							produce(input, (draft) => {
								draft.animeEpisodeNumber = v as number;
							}),
						)
					}
				/>
			) : null}
			{entityToReview.metadataLot === MediaLot.Manga ? (
				<>
					<Group wrap="nowrap">
						<NumberInput
							hideControls
							label="Chapter"
							value={
								input.mangaChapterNumber
									? Number(input.mangaChapterNumber)
									: undefined
							}
							onChange={(v) =>
								setInput(
									produce(input, (draft) => {
										draft.mangaChapterNumber = v?.toString();
									}),
								)
							}
						/>
						<Text ta="center" fw="bold" mt="sm">
							OR
						</Text>
						<NumberInput
							hideControls
							label="Volume"
							value={input.mangaVolumeNumber || undefined}
							onChange={(v) =>
								setInput(
									produce(input, (draft) => {
										draft.mangaVolumeNumber = v as number;
									}),
								)
							}
						/>
					</Group>
				</>
			) : null}
			<Textarea
				autosize
				autoFocus
				minRows={10}
				maxRows={20}
				label="Review"
				value={input.text || ""}
				description="Markdown is supported"
				onChange={(e) =>
					setInput(
						produce(input, (draft) => {
							draft.text = e.target.value;
						}),
					)
				}
			/>
			<Box>
				<Input.Label>Visibility</Input.Label>
				<SegmentedControl
					fullWidth
					value={input.visibility || Visibility.Public}
					data={Object.entries(Visibility).map(([k, v]) => ({
						label: changeCase(k),
						value: v,
					}))}
					onChange={(v) =>
						setInput(
							produce(input, (draft) => {
								draft.visibility = v as Visibility;
							}),
						)
					}
				/>
			</Box>
			<Button
				mt="md"
				w="100%"
				loading={reviewMutation.isPending}
				onClick={async () => {
					events.postReview(entityToReview.entityTitle);
					await reviewMutation.mutateAsync();
					revalidator.revalidate();
					refreshEntityDetails(entityToReview.entityId);
					notifications.show({
						color: "green",
						message: entityToReview.existingReview?.id
							? "Your review has been updated"
							: "Your review has been created",
					});
					props.closeReviewEntityModal();
				}}
			>
				{entityToReview.existingReview?.id ? "Update" : "Submit"}
			</Button>
		</Stack>
	);
};
