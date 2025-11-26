import {
	ActionIcon,
	Avatar,
	Box,
	Button,
	Collapse,
	Divider,
	Flex,
	Group,
	Paper,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	type EntityLot,
	type MediaLot,
	type ReviewItem,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import {
	CreateReviewCommentDocument,
	type CreateReviewCommentInput,
} from "@ryot/generated/graphql/backend/graphql";
import { DeleteReviewDocument } from "@ryot/generated/graphql/backend/graphql";
import { getInitials, isNumber } from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconCheck,
	IconEdit,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { match } from "ts-pattern";
import { useSavedForm } from "~/lib/hooks/use-saved-form";
import { reviewYellow } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useUserDetails, useUserPreferences } from "~/lib/shared/hooks";
import {
	convertDecimalToThreePointSmiley,
	convertRatingToUserScale,
	formatRatingForDisplay,
	getRatingUnitSuffix,
} from "~/lib/shared/media-utils";
import {
	clientGqlService,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { useReviewEntity } from "~/lib/state/media";
import { getThreePointSmileyEmoji } from "~/lib/types";
import classes from "~/styles/common.module.css";

export const DisplayThreePointReview = (props: {
	size?: number;
	rating?: number | null;
}) => {
	if (props.rating == null) return null;
	const smileyRating = convertDecimalToThreePointSmiley(props.rating);
	const fontSize = props.size ? `${props.size}px` : "20px";

	return (
		<Text style={{ fontSize, lineHeight: 1 }} component="span">
			{getThreePointSmileyEmoji(smileyRating)}
		</Text>
	);
};

export const ReviewItemDisplay = (props: {
	title: string;
	lot?: MediaLot;
	entityId: string;
	review: ReviewItem;
	entityLot: EntityLot;
}) => {
	const userDetails = useUserDetails();
	const userPreferences = useUserPreferences();
	const reviewScale = userPreferences.general.reviewScale;
	const ratingValue = convertRatingToUserScale(
		props.review.rating,
		reviewScale,
	);
	const ratingStringForScale =
		ratingValue == null
			? null
			: formatRatingForDisplay(ratingValue, reviewScale);
	const ratingSuffix = getRatingUnitSuffix(reviewScale);
	const [opened, { toggle }] = useDisclosure(false);
	const [openedLeaveComment, { toggle: toggleLeaveComment }] =
		useDisclosure(false);
	const deleteReviewMutation = useMutation({
		mutationFn: (reviewId: string) =>
			clientGqlService.request(DeleteReviewDocument, { reviewId }),
		onSuccess: () => {
			refreshEntityDetails(props.entityId);
			notifications.show({
				color: "green",
				message: "Review deleted successfully",
			});
		},
		onError: () =>
			notifications.show({ color: "red", message: "Failed to delete review" }),
	});
	const [_, setEntityToReview] = useReviewEntity();
	const seenItemsAssociatedWith = props.review.seenItemsAssociatedWith.length;

	const reviewCommentMutation = useMutation({
		mutationFn: (input: CreateReviewCommentInput) =>
			clientGqlService.request(CreateReviewCommentDocument, { input }),
		onSuccess: (_d, variables) => {
			refreshEntityDetails(props.entityId);
			const message =
				variables.incrementLikes || variables.decrementLikes
					? "Likes updated"
					: `Comment ${variables.shouldDelete ? "deleted" : "posted"} successfully`;
			notifications.show({ color: "green", message });
		},
		onError: () =>
			notifications.show({ color: "red", message: "Failed to update comment" }),
	});

	const form = useSavedForm({
		initialValues: { comment: "" },
		storageKeyPrefix: "ReviewItem",
	});

	const RenderedText = () =>
		props.review.textRendered ? (
			<div
				// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
				dangerouslySetInnerHTML={{
					__html: props.review.textRendered,
				}}
			/>
		) : null;

	return (
		<>
			<Box data-review-id={props.review.id} mb="md">
				<Group justify="space-between">
					<Flex align="center" gap="sm">
						<Avatar color="cyan" radius="xl">
							{getInitials(props.review.postedBy.name)}
						</Avatar>
						<Box>
							<Text>{props.review.postedBy.name}</Text>
							<Text>{dayjsLib(props.review.postedOn).format("L")}</Text>
						</Box>
						{userDetails.id === props.review.postedBy.id ? (
							<>
								<ActionIcon
									onClick={() => {
										setEntityToReview({
											metadataLot: props.lot,
											entityId: props.entityId,
											entityTitle: props.title,
											entityLot: props.entityLot,
											existingReview: props.review,
										});
									}}
								>
									<IconEdit size={16} />
								</ActionIcon>
								<ActionIcon
									color="red"
									disabled={deleteReviewMutation.isPending}
									onClick={() => {
										openConfirmationModal(
											"Are you sure you want to delete this review? This action cannot be undone.",
											() => deleteReviewMutation.mutate(props.review.id),
										);
									}}
								>
									<IconTrash size={16} />
								</ActionIcon>
							</>
						) : null}
					</Flex>
					{seenItemsAssociatedWith > 0 ? (
						<Text size="xs" c="dimmed">
							Associated with {seenItemsAssociatedWith} seen item
							{seenItemsAssociatedWith > 1 ? "s" : ""}
						</Text>
					) : null}
				</Group>
				<Box ml="sm" mt="xs">
					<Group mb="sm">
						{ratingValue != null && ratingValue > 0
							? match(userPreferences.general.reviewScale)
									.with(UserReviewScale.ThreePointSmiley, () => (
										<DisplayThreePointReview rating={ratingValue} />
									))
									.otherwise(() => (
										<Flex align="center" gap={4}>
											<IconStarFilled
												size={16}
												style={{ color: reviewYellow }}
											/>
											<Text className={classes.text} fw="bold">
												{ratingStringForScale}
												{ratingSuffix}
											</Text>
										</Flex>
									))
							: null}
						{isNumber(props.review.showExtraInformation?.season) ? (
							<Text c="dimmed">
								S{props.review.showExtraInformation.season}
								{props.review.showExtraInformation.episode
									? `-E${props.review.showExtraInformation.episode}`
									: undefined}
							</Text>
						) : null}
						{isNumber(props.review.podcastExtraInformation?.episode) ? (
							<Text c="dimmed">
								EP-{props.review.podcastExtraInformation.episode}
							</Text>
						) : null}
						{isNumber(props.review.animeExtraInformation?.episode) ? (
							<Text c="dimmed">
								EP-{props.review.animeExtraInformation.episode}
							</Text>
						) : null}
						{isNumber(props.review.mangaExtraInformation?.chapter) ? (
							<Text c="dimmed">
								Ch-{props.review.mangaExtraInformation.chapter}
							</Text>
						) : null}
						{isNumber(props.review.mangaExtraInformation?.volume) ? (
							<Text c="dimmed">
								VOL-{props.review.mangaExtraInformation.volume}
							</Text>
						) : null}
					</Group>
					{props.review.textRendered ? (
						!props.review.isSpoiler ? (
							<RenderedText />
						) : (
							<>
								{!opened ? (
									<Button onClick={toggle} variant="subtle" size="compact-md">
										Show spoiler
									</Button>
								) : null}
								<Collapse in={opened}>
									<RenderedText />
								</Collapse>
							</>
						)
					) : null}
					{openedLeaveComment ? (
						<form
							onSubmit={form.onSubmit(async (values) => {
								await reviewCommentMutation.mutateAsync({
									text: values.comment,
									reviewId: props.review.id,
								});
								form.reset();
								form.clearSavedState();
								toggleLeaveComment();
							})}
						>
							<Group>
								<TextInput
									flex={1}
									key={form.key("comment")}
									placeholder="Enter comment"
									{...form.getInputProps("comment")}
								/>
								<ActionIcon color="green" type="submit">
									<IconCheck />
								</ActionIcon>
								<ActionIcon color="red" onClick={toggleLeaveComment}>
									<IconX />
								</ActionIcon>
							</Group>
						</form>
					) : (
						<Button
							variant="outline"
							size="compact-md"
							onClick={toggleLeaveComment}
						>
							Leave comment
						</Button>
					)}
					{props.review.comments.length > 0 ? (
						<Paper withBorder ml="xl" mt="sm" p="xs">
							<Stack>
								{props.review.comments.map((c) => (
									<Stack key={c.id}>
										<Flex align="center" gap="sm">
											<Avatar color="cyan" radius="xl">
												{getInitials(c.user.name)}
											</Avatar>
											<Box>
												<Text>{c.user.name}</Text>
												{c.createdOn ? (
													<Text>{dayjsLib(c.createdOn).format("L")}</Text>
												) : null}
											</Box>
											{userDetails.id === c.user.id ? (
												<ActionIcon
													color="red"
													onClick={() => {
														openConfirmationModal(
															"Are you sure you want to delete this comment?",
															async () =>
																await reviewCommentMutation.mutateAsync({
																	commentId: c.id,
																	shouldDelete: true,
																	reviewId: props.review.id,
																}),
														);
													}}
												>
													<IconTrash size={16} />
												</ActionIcon>
											) : null}
											<ActionIcon
												onClick={async () => {
													await reviewCommentMutation.mutateAsync({
														commentId: c.id,
														reviewId: props.review.id,
														incrementLikes: !c.likedBy.includes(userDetails.id),
														decrementLikes: c.likedBy.includes(userDetails.id),
													});
												}}
											>
												<IconArrowBigUp size={16} />
												<Text>{c.likedBy.length}</Text>
											</ActionIcon>
										</Flex>
										<Text ml="xs">{c.text}</Text>
									</Stack>
								))}
							</Stack>
						</Paper>
					) : null}
				</Box>
			</Box>
			<Divider mb="md" />
		</>
	);
};
