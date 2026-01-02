import {
	Box,
	Button,
	Checkbox,
	Flex,
	Group,
	Input,
	NumberInput,
	Rating,
	rem,
	SegmentedControl,
	Select,
	Stack,
	Text,
	Textarea,
	ThemeIcon,
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
import { IconPercentage } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { match } from "ts-pattern";
import { useSavedForm } from "~/lib/hooks/use-saved-form";
import {
	useApplicationEvents,
	useMetadataDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import {
	convertDecimalToThreePointSmiley,
	convertRatingToUserScale,
} from "~/lib/shared/media-utils";
import {
	clientGqlService,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import { useReviewEntity } from "~/lib/state/media";
import { getThreePointSmileyEmoji, ThreePointSmileyRating } from "~/lib/types";
import { convertThreePointSmileyToDecimal } from "../utils";

export const ReviewEntityForm = (props: {
	closeReviewEntityModal: () => void;
}) => {
	const userPreferences = useUserPreferences();
	const events = useApplicationEvents();
	const [entityToReview] = useReviewEntity();
	const [{ data: metadataDetails }] = useMetadataDetails(
		entityToReview?.entityId,
		entityToReview?.entityLot === EntityLot.Metadata,
	);

	const form = useSavedForm<
		Omit<
			CreateOrUpdateReviewInput,
			"showSeasonNumber" | "showEpisodeNumber" | "podcastEpisodeNumber"
		> & {
			ratingInThreePointSmiley?: ThreePointSmileyRating;
			showSeasonNumber?: string;
			showEpisodeNumber?: string;
			podcastEpisodeNumber?: string;
		}
	>({
		storageKeyPrefix: `ReviewEntityForm-${entityToReview?.entityId}`,
		initialValues: {
			entityId: entityToReview?.entityId || "",
			reviewId: entityToReview?.existingReview?.id,
			text: entityToReview?.existingReview?.textOriginal || "",
			entityLot: entityToReview?.entityLot || EntityLot.Metadata,
			isSpoiler: entityToReview?.existingReview?.isSpoiler || false,
			visibility:
				entityToReview?.existingReview?.visibility || Visibility.Public,
			mangaVolumeNumber:
				entityToReview?.existingReview?.mangaExtraInformation?.volume,
			animeEpisodeNumber:
				entityToReview?.existingReview?.animeExtraInformation?.episode,
			mangaChapterNumber:
				entityToReview?.existingReview?.mangaExtraInformation?.chapter,
			showSeasonNumber:
				entityToReview?.existingReview?.showExtraInformation?.season?.toString(),
			showEpisodeNumber:
				entityToReview?.existingReview?.showExtraInformation?.episode?.toString(),
			podcastEpisodeNumber:
				entityToReview?.existingReview?.podcastExtraInformation?.episode?.toString(),
			rating: entityToReview?.existingReview?.rating
				? convertRatingToUserScale(
						entityToReview.existingReview.rating,
						userPreferences.general.reviewScale,
					)?.toString()
				: undefined,
			ratingInThreePointSmiley: entityToReview?.existingReview?.rating
				? convertDecimalToThreePointSmiley(
						Number(entityToReview.existingReview.rating),
					)
				: undefined,
		},
	});

	const reviewMutation = useMutation({
		mutationFn: (body: { input: CreateOrUpdateReviewInput }) =>
			clientGqlService.request(CreateOrUpdateReviewDocument, body),
		onSuccess: () => {
			refreshEntityDetails(entityToReview?.entityId || "");
			notifications.show({
				color: "green",
				message: entityToReview?.existingReview?.id
					? "Your review has been updated"
					: "Your review has been created",
			});
			form.clearSavedState();
			props.closeReviewEntityModal();
		},
		onError: () => {
			notifications.show({
				color: "red",
				message: "Failed to submit review",
			});
		},
	});

	const SmileySurround = (props: {
		children: ReactNode;
		smileyRating: ThreePointSmileyRating;
	}) => (
		<ThemeIcon
			size="xl"
			style={{ cursor: "pointer" }}
			variant={
				props.smileyRating === form.values.ratingInThreePointSmiley
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
		<form
			onSubmit={form.onSubmit((values) => {
				events.postReview(entityToReview?.entityTitle);
				const {
					ratingInThreePointSmiley,
					showSeasonNumber,
					showEpisodeNumber,
					podcastEpisodeNumber,
					...rest
				} = values;
				const input: CreateOrUpdateReviewInput = {
					...rest,
					showSeasonNumber: showSeasonNumber
						? Number(showSeasonNumber)
						: undefined,
					showEpisodeNumber: showEpisodeNumber
						? Number(showEpisodeNumber)
						: undefined,
					podcastEpisodeNumber: podcastEpisodeNumber
						? Number(podcastEpisodeNumber)
						: undefined,
				};
				reviewMutation.mutate({ input });
			})}
		>
			<Stack>
				<Flex align="center" gap="xl">
					{match(userPreferences.general.reviewScale)
						.with(UserReviewScale.OutOfFive, () => (
							<Flex gap="sm" mt="lg">
								<Input.Label>Rating:</Input.Label>
								<Rating
									fractions={2}
									value={
										form.values.rating ? Number(form.values.rating) : undefined
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
									form.values.rating ? Number(form.values.rating) : undefined
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
									form.values.rating ? Number(form.values.rating) : undefined
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
								<Group justify="space-around" wrap="nowrap">
									<SmileySurround smileyRating={ThreePointSmileyRating.Happy}>
										<Text size="xl">
											{getThreePointSmileyEmoji(ThreePointSmileyRating.Happy)}
										</Text>
									</SmileySurround>
									<SmileySurround smileyRating={ThreePointSmileyRating.Neutral}>
										<Text size="xl">
											{getThreePointSmileyEmoji(ThreePointSmileyRating.Neutral)}
										</Text>
									</SmileySurround>
									<SmileySurround smileyRating={ThreePointSmileyRating.Sad}>
										<Text size="xl">
											{getThreePointSmileyEmoji(ThreePointSmileyRating.Sad)}
										</Text>
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
							value={form.values.showSeasonNumber}
							onChange={(v) => {
								form.setFieldValue("showSeasonNumber", v as string | undefined);
								form.setFieldValue(
									"showEpisodeNumber",
									undefined as string | undefined,
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
							value={form.values.showEpisodeNumber}
							onChange={(v) => {
								form.setFieldValue(
									"showEpisodeNumber",
									v as string | undefined,
								);
							}}
							data={
								metadataDetails?.showSpecifics?.seasons
									.find(
										(s) =>
											s.seasonNumber.toString() ===
											form.values.showSeasonNumber,
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
						value={form.values.podcastEpisodeNumber}
						onChange={(v) => {
							form.setFieldValue(
								"podcastEpisodeNumber",
								v as string | undefined,
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
						value={form.values.animeEpisodeNumber || undefined}
						onChange={(v) =>
							form.setFieldValue("animeEpisodeNumber", v as number)
						}
					/>
				) : null}
				{entityToReview.metadataLot === MediaLot.Manga ? (
					<Group wrap="nowrap">
						<NumberInput
							hideControls
							label="Chapter"
							value={
								form.values.mangaChapterNumber
									? Number(form.values.mangaChapterNumber)
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
							value={form.values.mangaVolumeNumber || undefined}
							onChange={(v) =>
								form.setFieldValue("mangaVolumeNumber", v as number)
							}
						/>
					</Group>
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
						value={form.values.visibility || Visibility.Public}
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
					type="submit"
					loading={reviewMutation.isPending}
				>
					{entityToReview.existingReview?.id ? "Update" : "Submit"}
				</Button>
			</Stack>
		</form>
	);
};
