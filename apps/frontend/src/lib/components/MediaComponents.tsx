import { APP_ROUTES } from "@/lib/constants";
import {
	useCommitMedia,
	useCoreDetails,
	useUser,
	useUserPreferences,
} from "@/lib/hooks/graphql";
import { gqlClient } from "@/lib/services/api";
import { Verb, getFallbackImageUrl, getLot, getVerb } from "@/lib/utilities";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Button,
	Collapse,
	Divider,
	Flex,
	Image,
	Loader,
	Paper,
	ScrollArea,
	Stack,
	Text,
	Tooltip,
	useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	AddMediaToCollectionDocument,
	type AddMediaToCollectionMutationVariables,
	CreateReviewCommentDocument,
	type CreateReviewCommentMutationVariables,
	MetadataLot,
	MetadataSource,
	type PartialMetadata,
	type ReviewItem,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials } from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconEdit,
	IconStarFilled,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Link from "next/link";
import { useRouter } from "next/router";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import classes from "./styles.module.css";

export const PartialMetadataDisplay = (props: { media: PartialMetadata }) => {
	return (
		<Anchor
			component={Link}
			data-media-id={props.media.identifier}
			href={
				props.media.metadataId
					? withQuery(APP_ROUTES.media.individualMediaItem.details, {
							id: props.media.metadataId,
					  })
					: withQuery(APP_ROUTES.media.individualMediaItem.commit, {
							identifier: props.media.identifier,
							lot: props.media.lot,
							source: props.media.source,
					  })
			}
		>
			<Avatar
				imageProps={{ loading: "lazy" }}
				radius="sm"
				src={props.media.image}
				h={100}
				w={85}
				mx="auto"
				alt={`${props.media.title} picture`}
				styles={{ image: { objectPosition: "top" } }}
			/>
			<Text c="dimmed" size="xs" ta="center" lineClamp={1} mt={4}>
				{props.media.title}
			</Text>
		</Anchor>
	);
};

export const MediaScrollArea = (props: { children: JSX.Element }) => {
	const coreDetails = useCoreDetails();

	return coreDetails.data ? (
		<ScrollArea.Autosize mah={coreDetails.data.itemDetailsHeight}>
			{props.children}
		</ScrollArea.Autosize>
	) : undefined;
};

export const ReviewItemDisplay = ({
	review,
	metadataId,
	creatorId,
	refetch,
}: {
	review: DeepPartial<ReviewItem>;
	metadataId?: number;
	creatorId?: number;
	refetch: () => void;
}) => {
	const [opened, { toggle }] = useDisclosure(false);
	const user = useUser();
	const userPreferences = useUserPreferences();
	const createReviewComment = useMutation({
		mutationFn: async (variables: CreateReviewCommentMutationVariables) => {
			const { createReviewComment } = await gqlClient.request(
				CreateReviewCommentDocument,
				variables,
			);
			return createReviewComment;
		},
		onSuccess: () => {
			refetch();
		},
	});

	return userPreferences.data ? (
		<>
			<Box key={review.id} data-review-id={review.id}>
				<Flex align="center" gap="sm">
					<Avatar color="cyan" radius="xl">
						{getInitials(review.postedBy?.name || "")}{" "}
					</Avatar>
					<Box>
						<Text>{review.postedBy?.name}</Text>
						<Text>
							{DateTime.fromJSDate(
								review.postedOn || new Date(),
							).toLocaleString()}
						</Text>
					</Box>
					{user && user.id === review.postedBy?.id ? (
						<Anchor
							component={Link}
							href={withQuery(APP_ROUTES.media.postReview, {
								metadataId,
								creatorId,
								reviewId: review.id,
							})}
						>
							<ActionIcon>
								<IconEdit size={16} />
							</ActionIcon>
						</Anchor>
					) : undefined}
				</Flex>
				<Box ml="sm" mt="xs">
					{typeof review.showSeason === "number" ? (
						<Text c="dimmed">
							S{review.showSeason}-E
							{review.showEpisode}
						</Text>
					) : undefined}
					{typeof review.podcastEpisode === "number" ? (
						<Text c="dimmed">EP-{review.podcastEpisode}</Text>
					) : undefined}
					{(Number(review.rating) || 0) > 0 ? (
						<Flex align="center" gap={4}>
							<IconStarFilled size={16} style={{ color: "#EBE600FF" }} />
							<Text className={classes.text} fw="bold">
								{review.rating}
								{userPreferences.data.general.reviewScale ===
								UserReviewScale.OutOfFive
									? undefined
									: "%"}
							</Text>
						</Flex>
					) : undefined}
					{review.text ? (
						!review.spoiler ? (
							<>
								{/* biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely */}
								<div dangerouslySetInnerHTML={{ __html: review.text }} />
							</>
						) : (
							<>
								{!opened ? (
									<Button onClick={toggle} variant="subtle" size="compact-md">
										Show spoiler
									</Button>
								) : undefined}
								<Collapse in={opened}>
									{/* biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely */}
									<Text dangerouslySetInnerHTML={{ __html: review.text }} />
								</Collapse>
							</>
						)
					) : undefined}
					<Button
						variant="subtle"
						size="compact-md"
						onClick={() => {
							const comment = prompt("Enter comment");
							if (comment && review.id)
								createReviewComment.mutate({
									input: { reviewId: review.id, text: comment },
								});
						}}
					>
						Leave comment
					</Button>
					{(review.comments?.length || 0) > 0 ? (
						<Paper withBorder ml="xl" mt="sm" p="xs">
							<Stack>
								{review.comments
									? review.comments.map((c) => (
											<Stack key={c?.id}>
												<Flex align="center" gap="sm">
													<Avatar color="cyan" radius="xl">
														{getInitials(c?.user?.name || "")}{" "}
													</Avatar>
													<Box>
														<Text>{c?.user?.name}</Text>
														<Text>
															{DateTime.fromJSDate(
																c?.createdOn || new Date(),
															).toLocaleString()}
														</Text>
													</Box>
													{user && user.id === c?.user?.id ? (
														<ActionIcon
															color="red"
															onClick={() => {
																const yes = confirm(
																	"Are you sure you want to delete this comment?",
																);
																if (review.id && yes)
																	createReviewComment.mutate({
																		input: {
																			reviewId: review.id,
																			commentId: c.id,
																			shouldDelete: true,
																		},
																	});
															}}
														>
															<IconTrash size={16} />
														</ActionIcon>
													) : undefined}
													<ActionIcon
														onClick={() => {
															const likedByUser = c?.likedBy?.includes(
																user?.id,
															);
															if (review.id)
																createReviewComment.mutate({
																	input: {
																		reviewId: review.id,
																		commentId: c?.id,
																		incrementLikes: !likedByUser,
																		decrementLikes: likedByUser,
																	},
																});
														}}
													>
														<IconArrowBigUp size={16} />
														<Text>{c?.likedBy?.length}</Text>
													</ActionIcon>
												</Flex>
												<Text ml="xs">{c?.text}</Text>
											</Stack>
									  ))
									: undefined}
							</Stack>
						</Paper>
					) : undefined}
				</Box>
			</Box>
			<Divider />
		</>
	) : undefined;
};

export const BaseDisplayItem = (props: {
	name: string;
	imageLink?: string | null;
	imagePlaceholder: string;
	topRight?: JSX.Element;
	topLeft?: JSX.Element;
	bottomLeft?: string | number | null;
	bottomRight?: string | number | null;
	href: string;
	highlightRightText?: string;
	children?: JSX.Element;
}) => {
	const colorScheme = useComputedColorScheme("dark");

	return (
		<Flex
			key={`${props.bottomLeft}-${props.bottomRight}-${props.name}`}
			align="center"
			justify="center"
			direction="column"
			pos="relative"
		>
			{props.topLeft}
			<Anchor
				component={Link}
				href={props.href}
				style={{ flex: "none" }}
				pos="relative"
			>
				<Image
					src={props.imageLink}
					radius="md"
					style={{ cursor: "pointer" }}
					alt={`Image for ${props.name}`}
					className={classes.mediaImage}
					styles={{
						root: {
							transitionProperty: "transform",
							transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
							transitionDuration: "150ms",
						},
					}}
					h={260}
					w={170}
					fallbackSrc={getFallbackImageUrl(
						colorScheme,
						getInitials(props.name),
					)}
				/>
				{props.topRight}
			</Anchor>
			<Flex w="100%" direction="column" px={{ base: 10, md: 3 }}>
				<Flex justify="space-between" direction="row" w="100%">
					<Text c="dimmed" size="sm">
						{props.bottomLeft}
					</Text>
					<Tooltip
						label={props.highlightRightText}
						disabled={props.highlightRightText ? false : true}
						position="right"
					>
						<Text c={props.highlightRightText ? "yellow" : "dimmed"} size="sm">
							{props.bottomRight}
						</Text>
					</Tooltip>
				</Flex>
				<Tooltip label={props.name} position="right">
					<Text w="100%" truncate fw="bold" mb="xs">
						{props.name}
					</Text>
				</Tooltip>
				{props.children}
			</Flex>
		</Flex>
	);
};

type Item = {
	identifier: string;
	title: string;
	image?: string | null;
	publishYear?: string | null;
};

export const MediaItemWithoutUpdateModal = (props: {
	item: Item;
	lot: MetadataLot;
	children?: JSX.Element;
	imageOverlayForLoadingIndicator?: boolean;
	href: string;
	existsInDatabase?: boolean;
	averageRating?: string;
	noRatingLink?: boolean;
}) => {
	const userPreferences = useUserPreferences();
	const router = useRouter();
	const nextPath = withQuery(router.pathname, router.query);

	return userPreferences.data ? (
		<BaseDisplayItem
			href={props.href}
			imageLink={props.item.image}
			imagePlaceholder={getInitials(props.item?.title || "")}
			topLeft={
				props.imageOverlayForLoadingIndicator ? (
					<Loader
						pos="absolute"
						style={{ zIndex: 999 }}
						top={10}
						left={10}
						color="red"
						variant="bars"
						size="sm"
					/>
				) : undefined
			}
			topRight={
				props.averageRating ? (
					<Box
						p={2}
						pos="absolute"
						top={5}
						right={5}
						style={{
							backgroundColor: "rgba(0, 0, 0, 0.75)",
							borderRadius: 3,
						}}
					>
						<Flex align="center" gap={4}>
							<IconStarFilled size={12} style={{ color: "#EBE600FF" }} />
							<Text c="white" size="xs" fw="bold" pr={4}>
								{match(userPreferences.data.general.reviewScale)
									.with(UserReviewScale.OutOfFive, () =>
										// biome-ignore lint/style/noNonNullAssertion: it is validated above
										parseFloat(props.averageRating!.toString()).toFixed(1),
									)
									.with(UserReviewScale.OutOfHundred, () => props.averageRating)
									.exhaustive()}{" "}
								{userPreferences.data.general.reviewScale ===
								UserReviewScale.OutOfFive
									? undefined
									: "%"}
							</Text>
						</Flex>
					</Box>
				) : props.noRatingLink ? undefined : (
					<Link
						href={withQuery(APP_ROUTES.media.postReview, {
							metadataId: props.item.identifier,
							next: nextPath,
						})}
					>
						<Box
							p={3}
							pos="absolute"
							top={5}
							right={5}
							style={{
								backgroundColor: "rgba(0, 0, 0, 0.75)",
								borderRadius: 3,
							}}
						>
							<Flex align="center" gap={4}>
								<IconStarFilled size={16} className={classes.starIcon} />
							</Flex>
						</Box>
					</Link>
				)
			}
			bottomLeft={props.item.publishYear}
			bottomRight={changeCase(props.lot || "")}
			highlightRightText={
				props.existsInDatabase ? "This media exists in the database" : undefined
			}
			name={props.item.title}
			children={props.children}
		/>
	) : undefined;
};

export const MediaSearchItem = (props: {
	item: Item;
	idx: number;
	query: string;
	lot: MetadataLot;
	source: MetadataSource;
	searchQueryRefetch: () => void;
	maybeItemId?: number;
}) => {
	const router = useRouter();
	const lot = getLot(router.query.lot);

	const commitMedia = useCommitMedia(lot);
	const addMediaToCollection = useMutation({
		mutationFn: async (variables: AddMediaToCollectionMutationVariables) => {
			const { addMediaToCollection } = await gqlClient.request(
				AddMediaToCollectionDocument,
				variables,
			);
			return addMediaToCollection;
		},
		onSuccess: () => {
			props.searchQueryRefetch();
			notifications.show({
				title: "Success",
				message: "Media added to watchlist successfully",
			});
		},
	});

	const commitFunction = async () => {
		const { id } = await commitMedia.mutateAsync({
			identifier: props.item.identifier,
			lot: props.lot,
			source: props.source,
		});
		props.searchQueryRefetch();
		return id;
	};

	return (
		<MediaItemWithoutUpdateModal
			item={props.item}
			lot={props.lot}
			imageOverlayForLoadingIndicator={commitMedia.isLoading}
			href={
				props.maybeItemId
					? withQuery(APP_ROUTES.media.individualMediaItem.details, {
							id: props.maybeItemId,
					  })
					: withQuery(APP_ROUTES.media.individualMediaItem.commit, {
							identifier: props.item.identifier,
							lot: props.lot,
							source: props.source,
					  })
			}
			existsInDatabase={!!props.maybeItemId}
			noRatingLink
		>
			<>
				{props.lot !== MetadataLot.Show ? (
					<Button
						variant="outline"
						w="100%"
						size="compact-md"
						onClick={async () => {
							const id = await commitFunction();
							const nextPath = withQuery(router.pathname, router.query);
							router.push(
								withQuery(APP_ROUTES.media.individualMediaItem.updateProgress, {
									id,
									next: nextPath,
								}),
							);
						}}
					>
						Mark as {getVerb(Verb.Read, props.lot)}
					</Button>
				) : (
					<>
						<Button
							variant="outline"
							w="100%"
							size="compact-md"
							onClick={async () => {
								const id = await commitFunction();
								router.push(
									withQuery(APP_ROUTES.media.individualMediaItem.details, {
										id,
									}),
								);
							}}
						>
							Show details
						</Button>
					</>
				)}
				<Button
					mt="xs"
					variant="outline"
					w="100%"
					size="compact-md"
					onClick={async () => {
						const id = await commitFunction();
						addMediaToCollection.mutate({
							input: { collectionName: "Watchlist", mediaId: id },
						});
					}}
					disabled={addMediaToCollection.isLoading}
				>
					Add to Watchlist
				</Button>
			</>
		</MediaItemWithoutUpdateModal>
	);
};
