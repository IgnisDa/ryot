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
import { useForm } from "@mantine/form";
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
import type { ReactNode } from "react";
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
	const { data: metadataDetails } = useMetadataDetails(
		entityToReview?.entityId,
		entityToReview?.entityLot === EntityLot.Metadata,
	);

	const form = useForm<
		CreateOrUpdateReviewInput & {
			ratingInThreePointSmiley?: ThreePointSmileyRating;
			showSeasonNumberString?: string;
			showEpisodeNumberString?: string;
			podcastEpisodeNumberString?: string;
		}
	>({
		mode: "uncontrolled",
		initialValues: {
			entityId: entityToReview?.entityId || "",
			reviewId: entityToReview?.existingReview?.id,
			text: entityToReview?.existingReview?.textOriginal || "",
			entityLot: entityToReview?.entityLot || EntityLot.Metadata,
			isSpoiler: entityToReview?.existingReview?.isSpoiler || false,
			visibility:
				entityToReview?.existingReview?.visibility || Visibility.Public,
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
			ratingInThreePointSmiley: entityToReview?.existingReview?.rating
				? convertDecimalToThreePointSmiley(
						Number(entityToReview.existingReview.rating),
					)
				: undefined,
			showSeasonNumberString:
				entityToReview?.existingReview?.showExtraInformation?.season?.toString(),
			showEpisodeNumberString:
				entityToReview?.existingReview?.showExtraInformation?.episode?.toString(),
			podcastEpisodeNumberString:
				entityToReview?.existingReview?.podcastExtraInformation?.episode?.toString(),
		},
	});

	const reviewMutation = useMutation({
		mutationFn: () => {
			const formValues = form.getValues();
			const input: CreateOrUpdateReviewInput = {
				text: formValues.text,
				rating: formValues.rating,
				entityId: formValues.entityId,
				reviewId: formValues.reviewId,
				entityLot: formValues.entityLot,
				isSpoiler: formValues.isSpoiler,
				visibility: formValues.visibility,
				showSeasonNumber: formValues.showSeasonNumber,
				showEpisodeNumber: formValues.showEpisodeNumber,
				mangaVolumeNumber: formValues.mangaVolumeNumber,
				animeEpisodeNumber: formValues.animeEpisodeNumber,
				mangaChapterNumber: formValues.mangaChapterNumber,
				podcastEpisodeNumber: formValues.podcastEpisodeNumber,
			};
			return clientGqlService.request(CreateOrUpdateReviewDocument, { input });
		},
	});

	const SmileySurround = (props: {
		children: ReactNode;
		smileyRating: ThreePointSmileyRating;
	}) => (
		<ThemeIcon
			size="xl"
			variant={
				props.smileyRating === form.getValues().ratingInThreePointSmiley
					? "outline"
					: "transparent"
			}
			onClick={() => {
				form.setFieldValue("ratingInThreePointSmiley", props.smileyRating);
				form.setFieldValue(
					"rating",
					convertThreePointSmileyToDecimal(props.smileyRating).toString(),
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
								value={
									form.getValues().rating
										? Number(form.getValues().rating)
										: undefined
								}
								onChange={(v) =>
									form.setFieldValue("rating", v ? v.toString() : undefined)
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
							value={
								form.getValues().rating
									? Number(form.getValues().rating)
									: undefined
							}
							onChange={(v) =>
								form.setFieldValue("rating", v ? v.toString() : undefined)
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
							value={
								form.getValues().rating
									? Number(form.getValues().rating)
									: undefined
							}
							onChange={(v) =>
								form.setFieldValue("rating", v ? v.toString() : undefined)
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
					{...form.getInputProps("isSpoiler", { type: "checkbox" })}
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
						value={form.getValues().showSeasonNumberString}
						onChange={(v) => {
							form.setFieldValue("showSeasonNumberString", v || undefined);
							form.setFieldValue("showSeasonNumber", v ? Number(v) : undefined);
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
						value={form.getValues().showEpisodeNumberString}
						onChange={(v) => {
							form.setFieldValue("showEpisodeNumberString", v || undefined);
							form.setFieldValue(
								"showEpisodeNumber",
								v ? Number(v) : undefined,
							);
						}}
						data={
							metadataDetails?.showSpecifics?.seasons
								.find(
									(s) =>
										s.seasonNumber.toString() ===
										form.getValues().showSeasonNumberString,
								)
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
					value={form.getValues().podcastEpisodeNumberString}
					onChange={(v) => {
						form.setFieldValue("podcastEpisodeNumberString", v || undefined);
						form.setFieldValue(
							"podcastEpisodeNumber",
							v ? Number(v) : undefined,
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
					value={form.getValues().animeEpisodeNumber || undefined}
					onChange={(v) =>
						form.setFieldValue("animeEpisodeNumber", v as number)
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
								form.getValues().mangaChapterNumber
									? Number(form.getValues().mangaChapterNumber)
									: undefined
							}
							onChange={(v) =>
								form.setFieldValue("mangaChapterNumber", v?.toString())
							}
						/>
						<Text ta="center" fw="bold" mt="sm">
							OR
						</Text>
						<NumberInput
							hideControls
							label="Volume"
							value={form.getValues().mangaVolumeNumber || undefined}
							onChange={(v) =>
								form.setFieldValue("mangaVolumeNumber", v as number)
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
				description="Markdown is supported"
				{...form.getInputProps("text")}
			/>
			<Box>
				<Input.Label>Visibility</Input.Label>
				<SegmentedControl
					fullWidth
					value={form.getValues().visibility || Visibility.Public}
					data={Object.entries(Visibility).map(([k, v]) => ({
						label: changeCase(k),
						value: v,
					}))}
					onChange={(v) => form.setFieldValue("visibility", v as Visibility)}
				/>
			</Box>
			<Button
				mt="md"
				w="100%"
				loading={reviewMutation.isPending}
				onClick={async () => {
					const validation = form.validate();
					if (validation.hasErrors) return;

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
