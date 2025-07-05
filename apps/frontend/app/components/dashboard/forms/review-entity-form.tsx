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
import {
	EntityLot,
	MediaLot,
	UserReviewScale,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, isNumber } from "@ryot/ts-utils";
import {
	IconMoodEmpty,
	IconMoodHappy,
	IconMoodSad,
	IconPercentage,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Form } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import {
	useApplicationEvents,
	useConfirmSubmit,
	useMetadataDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { convertDecimalToThreePointSmiley } from "~/lib/media-utils";
import { refreshEntityDetails } from "~/lib/query-factory";
import { useReviewEntity } from "~/lib/state/media";
import { ThreePointSmileyRating } from "~/lib/types";
import { convertThreePointSmileyToDecimal } from "../utils";

export const ReviewEntityForm = ({
	closeReviewEntityModal,
}: {
	closeReviewEntityModal: () => void;
}) => {
	const userPreferences = useUserPreferences();
	const events = useApplicationEvents();
	const submit = useConfirmSubmit();
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
	const [showEpisodeNumber, _setShowEpisodeNumber] = useState<
		string | undefined
	>(entityToReview?.existingReview?.showExtraInformation?.episode?.toString());
	const [podcastEpisodeNumber, _setPodcastEpisodeNumber] = useState<
		string | undefined
	>(
		entityToReview?.existingReview?.podcastExtraInformation?.episode?.toString(),
	);
	const { data: metadataDetails } = useMetadataDetails(
		entityToReview?.entityId,
		entityToReview?.entityLot === EntityLot.Metadata,
	);

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
			onClick={() => setRatingInThreePointSmiley(props.smileyRating)}
		>
			{props.children}
		</ThemeIcon>
	);

	if (!entityToReview) return null;

	return (
		<Form
			replace
			method="POST"
			action={withQuery("/actions", { intent: "performReviewAction" })}
			onSubmit={(e) => {
				submit(e);
				refreshEntityDetails(entityToReview.entityId);
				events.postReview(entityToReview.entityTitle);
				closeReviewEntityModal();
			}}
		>
			<input hidden name="entityId" value={entityToReview.entityId} readOnly />
			{userPreferences.general.reviewScale ===
				UserReviewScale.ThreePointSmiley && ratingInThreePointSmiley ? (
				<input
					hidden
					readOnly
					name="rating"
					value={convertThreePointSmileyToDecimal(ratingInThreePointSmiley)}
				/>
			) : undefined}
			<input
				hidden
				readOnly
				name="entityLot"
				value={entityToReview.entityLot}
			/>
			{entityToReview.existingReview?.id ? (
				<input
					hidden
					readOnly
					name="reviewId"
					value={entityToReview.existingReview.id}
				/>
			) : null}
			<Stack>
				<Flex align="center" gap="xl">
					{match(userPreferences.general.reviewScale)
						.with(UserReviewScale.OutOfFive, () => (
							<Flex gap="sm" mt="lg">
								<Input.Label>Rating:</Input.Label>
								<Rating
									name="rating"
									fractions={2}
									defaultValue={
										entityToReview.existingReview?.rating
											? Number(entityToReview.existingReview.rating)
											: undefined
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
								name="rating"
								label="Rating"
								rightSection={<IconPercentage size={16} />}
								defaultValue={
									entityToReview.existingReview?.rating
										? Number(entityToReview.existingReview.rating)
										: undefined
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
								name="rating"
								label="Rating"
								rightSectionWidth={rem(60)}
								rightSection={
									<Text size="xs" c="dimmed">
										Out of 10
									</Text>
								}
								defaultValue={
									entityToReview.existingReview?.rating
										? Number(entityToReview.existingReview.rating)
										: undefined
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
					<Checkbox label="This review is a spoiler" mt="lg" name="isSpoiler" />
				</Flex>
				{entityToReview.metadataLot === MediaLot.Show ? (
					<Stack gap={4}>
						<Select
							size="xs"
							clearable
							searchable
							limit={50}
							label="Season"
							name="showSeasonNumber"
							value={showSeasonNumber}
							onChange={(v) => setShowSeasonNumber(v || undefined)}
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
							name="showEpisodeNumber"
							value={showEpisodeNumber}
							onChange={(v) => _setShowEpisodeNumber(v || undefined)}
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
						name="podcastEpisodeNumber"
						value={podcastEpisodeNumber}
						onChange={(v) => _setPodcastEpisodeNumber(v || undefined)}
						data={metadataDetails?.podcastSpecifics?.episodes.map((se) => ({
							label: se.title.toString(),
							value: se.number.toString(),
						}))}
					/>
				) : null}
				{entityToReview.metadataLot === MediaLot.Anime ? (
					<NumberInput
						label="Episode"
						name="animeEpisodeNumber"
						hideControls
						defaultValue={
							isNumber(
								entityToReview.existingReview?.animeExtraInformation?.episode,
							)
								? entityToReview.existingReview.animeExtraInformation.episode
								: undefined
						}
					/>
				) : null}
				{entityToReview.metadataLot === MediaLot.Manga ? (
					<>
						<Group wrap="nowrap">
							<NumberInput
								label="Chapter"
								name="mangaChapterNumber"
								hideControls
								defaultValue={
									isNumber(
										entityToReview.existingReview?.mangaExtraInformation
											?.chapter,
									)
										? entityToReview.existingReview.mangaExtraInformation
												.chapter
										: undefined
								}
							/>
							<Text ta="center" fw="bold" mt="sm">
								OR
							</Text>
							<NumberInput
								label="Volume"
								name="mangaVolumeNumber"
								hideControls
								defaultValue={
									isNumber(
										entityToReview.existingReview?.mangaExtraInformation
											?.volume,
									)
										? entityToReview.existingReview.mangaExtraInformation.volume
										: undefined
								}
							/>
						</Group>
					</>
				) : null}
				<Textarea
					label="Review"
					name="text"
					description="Markdown is supported"
					autoFocus
					minRows={10}
					maxRows={20}
					autosize
					defaultValue={
						entityToReview.existingReview?.textOriginal ?? undefined
					}
				/>
				<Box>
					<Input.Label>Visibility</Input.Label>
					<SegmentedControl
						fullWidth
						data={Object.entries(Visibility).map(([k, v]) => ({
							label: changeCase(k),
							value: v,
						}))}
						defaultValue={
							entityToReview.existingReview?.visibility ?? Visibility.Public
						}
						name="visibility"
					/>
				</Box>
				<Button mt="md" type="submit" w="100%">
					{entityToReview.existingReview?.id ? "Update" : "Submit"}
				</Button>
			</Stack>
		</Form>
	);
};
