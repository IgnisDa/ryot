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
import {
	type EntityLot,
	type MediaLot,
	type ReviewItem,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { getInitials, isNumber } from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconCheck,
	IconEdit,
	IconMoodEmpty,
	IconMoodHappy,
	IconMoodSad,
	IconStarFilled,
	IconTrash,
} from "@tabler/icons-react";
import { Form, useFetcher } from "react-router";
import { $path } from "safe-routes";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { reviewYellow } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useConfirmSubmit,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { convertDecimalToThreePointSmiley } from "~/lib/shared/media-utils";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { useReviewEntity } from "~/lib/state/media";
import { ThreePointSmileyRating } from "~/lib/types";
import type { action } from "~/routes/actions";
import classes from "~/styles/common.module.css";

export const DisplayThreePointReview = (props: {
	size?: number;
	rating?: string | null;
}) =>
	match(convertDecimalToThreePointSmiley(Number(props.rating || "")))
		.with(ThreePointSmileyRating.Happy, () => (
			<IconMoodHappy size={props.size || 20} color={reviewYellow} />
		))
		.with(ThreePointSmileyRating.Neutral, () => (
			<IconMoodEmpty size={props.size || 20} color={reviewYellow} />
		))
		.with(ThreePointSmileyRating.Sad, () => (
			<IconMoodSad size={props.size || 20} color={reviewYellow} />
		))
		.exhaustive();

export const ReviewItemDisplay = (props: {
	title: string;
	lot?: MediaLot;
	entityId: string;
	entityLot: EntityLot;
	review: DeepPartial<ReviewItem>;
}) => {
	const userDetails = useUserDetails();
	const userPreferences = useUserPreferences();
	const submit = useConfirmSubmit();
	const reviewScale = userPreferences.general.reviewScale;
	const [opened, { toggle }] = useDisclosure(false);
	const [openedLeaveComment, { toggle: toggleLeaveComment }] =
		useDisclosure(false);
	const deleteReviewFetcher = useFetcher<typeof action>();
	const [_, setEntityToReview] = useReviewEntity();
	const seenItemsAssociatedWith =
		props.review.seenItemsAssociatedWith?.length || 0;

	return (
		<>
			<Box key={props.review.id} data-review-id={props.review.id} mb="md">
				<Group justify="space-between">
					<Flex align="center" gap="sm">
						<Avatar color="cyan" radius="xl">
							{getInitials(props.review.postedBy?.name || "")}
						</Avatar>
						<Box>
							<Text>{props.review.postedBy?.name}</Text>
							<Text>{dayjsLib(props.review.postedOn).format("L")}</Text>
						</Box>
						{userDetails.id === props.review.postedBy?.id ? (
							<>
								<ActionIcon
									onClick={() => {
										setEntityToReview({
											entityLot: props.entityLot,
											entityId: props.entityId,
											entityTitle: props.title,
											metadataLot: props.lot,
											existingReview: props.review,
										});
									}}
								>
									<IconEdit size={16} />
								</ActionIcon>
								<ActionIcon
									onClick={() => {
										openConfirmationModal(
											"Are you sure you want to delete this review? This action cannot be undone.",
											() => {
												deleteReviewFetcher.submit(
													{
														shouldDelete: "true",
														reviewId: props.review.id || null,
													},
													{
														method: "post",
														action: $path("/actions", {
															intent: "performReviewAction",
														}),
													},
												);
											},
										);
									}}
									color="red"
								>
									<IconTrash size={16} />
								</ActionIcon>
							</>
						) : null}
					</Flex>
					{seenItemsAssociatedWith > 0 ? (
						<Text
							size="xs"
							c="dimmed"
							data-seen-items-associated-with={JSON.stringify(
								props.review.seenItemsAssociatedWith,
							)}
						>
							Associated with {seenItemsAssociatedWith} seen item
							{seenItemsAssociatedWith > 1 ? "s" : ""}
						</Text>
					) : null}
				</Group>
				<Box ml="sm" mt="xs">
					<Group>
						{(Number(props.review.rating) || 0) > 0
							? match(userPreferences.general.reviewScale)
									.with(UserReviewScale.ThreePointSmiley, () => (
										<DisplayThreePointReview rating={props.review.rating} />
									))
									.otherwise(() => (
										<Flex align="center" gap={4}>
											<IconStarFilled
												size={16}
												style={{ color: reviewYellow }}
											/>
											<Text className={classes.text} fw="bold">
												{props.review.rating}
												{reviewScale === UserReviewScale.OutOfHundred
													? "%"
													: undefined}
												{reviewScale === UserReviewScale.OutOfTen
													? "/10"
													: undefined}
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
							<>
								<div
									// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
									dangerouslySetInnerHTML={{
										__html: props.review.textRendered,
									}}
								/>
							</>
						) : (
							<>
								{!opened ? (
									<Button onClick={toggle} variant="subtle" size="compact-md">
										Show spoiler
									</Button>
								) : null}
								<Collapse in={opened}>
									<Text
										// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
										dangerouslySetInnerHTML={{
											__html: props.review.textRendered,
										}}
									/>
								</Collapse>
							</>
						)
					) : null}
					{openedLeaveComment ? (
						<Form
							method="POST"
							onSubmit={(e) => {
								submit(e);
								toggleLeaveComment();
							}}
							action={withQuery("/actions", { intent: "createReviewComment" })}
						>
							<input hidden name="reviewId" defaultValue={props.review.id} />
							<Group>
								<TextInput
									name="text"
									placeholder="Enter comment"
									style={{ flex: 1 }}
								/>
								<ActionIcon color="green" type="submit">
									<IconCheck />
								</ActionIcon>
							</Group>
						</Form>
					) : null}
					{!openedLeaveComment ? (
						<Button
							variant="subtle"
							size="compact-md"
							onClick={toggleLeaveComment}
							type="submit"
						>
							Leave comment
						</Button>
					) : null}
					{(props.review.comments?.length || 0) > 0 ? (
						<Paper withBorder ml="xl" mt="sm" p="xs">
							<Stack>
								{props.review.comments
									? props.review.comments.map((c) => (
											<Stack key={c?.id}>
												<Flex align="center" gap="sm">
													<Avatar color="cyan" radius="xl">
														{getInitials(c?.user?.name || "")}{" "}
													</Avatar>
													<Box>
														<Text>{c?.user?.name}</Text>
														{c?.createdOn ? (
															<Text>{dayjsLib(c.createdOn).format("L")}</Text>
														) : null}
													</Box>
													{userDetails.id === c?.user?.id ? (
														<Form
															method="POST"
															action={withQuery("/actions", {
																intent: "createReviewComment",
															})}
														>
															<input
																hidden
																name="reviewId"
																defaultValue={props.review.id}
															/>
															<input
																hidden
																name="commentId"
																defaultValue={c?.id}
															/>
															<input
																hidden
																name="shouldDelete"
																defaultValue="true"
															/>
															<ActionIcon
																color="red"
																type="submit"
																onClick={(e) => {
																	const form = e.currentTarget.form;
																	e.preventDefault();
																	openConfirmationModal(
																		"Are you sure you want to delete this comment?",
																		() => submit(form),
																	);
																}}
															>
																<IconTrash size={16} />
															</ActionIcon>
														</Form>
													) : null}
													<Form
														method="POST"
														action={withQuery("/actions", {
															intent: "createReviewComment",
														})}
														onSubmit={submit}
													>
														<input
															hidden
															name="reviewId"
															defaultValue={props.review.id}
														/>
														<input
															hidden
															name="commentId"
															defaultValue={c?.id}
														/>
														<input
															hidden
															name="incrementLikes"
															value={String(
																!c?.likedBy?.includes(userDetails.id),
															)}
															readOnly
														/>
														<input
															hidden
															name="decrementLikes"
															value={String(
																c?.likedBy?.includes(userDetails.id),
															)}
															readOnly
														/>
														<ActionIcon type="submit">
															<IconArrowBigUp size={16} />
															<Text>{c?.likedBy?.length}</Text>
														</ActionIcon>
													</Form>
												</Flex>
												<Text ml="xs">{c?.text}</Text>
											</Stack>
										))
									: null}
							</Stack>
						</Paper>
					) : null}
				</Box>
			</Box>
			<Divider mb="md" />
		</>
	);
};
