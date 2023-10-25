import { APP_ROUTES } from "@/lib/constants";
import {
	useCommitMedia,
	useCoreDetails,
	useUser,
	useUserPreferences,
} from "@/lib/hooks/graphql";
import { gqlClient } from "@/lib/services/api";
import {
	Verb,
	getFallbackImageUrl,
	getLot,
	getStringAsciiValue,
	getVerb,
} from "@/lib/utilities";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Badge,
	Box,
	Button,
	Collapse,
	Divider,
	Flex,
	Image,
	Loader,
	Modal,
	Paper,
	ScrollArea,
	Select,
	Stack,
	Text,
	Title,
	Tooltip,
	useComputedColorScheme,
	useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	AddEntityToCollectionDocument,
	type AddEntityToCollectionMutationVariables,
	CreateReviewCommentDocument,
	type CreateReviewCommentMutationVariables,
	EntityLot,
	MetadataLot,
	MetadataSource,
	type PartialMetadata,
	RemoveEntityFromCollectionDocument,
	type RemoveEntityFromCollectionMutationVariables,
	type ReviewItem,
	UserCollectionsListDocument,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials } from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconEdit,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
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

export const ReviewItemDisplay = (props: {
	review: DeepPartial<ReviewItem>;
	metadataId?: number;
	metadataGroupId?: number;
	personId?: number;
	collectionId?: number;
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
			props.refetch();
		},
	});

	return userPreferences.data ? (
		<>
			<Box key={props.review.id} data-review-id={props.review.id}>
				<Flex align="center" gap="sm">
					<Avatar color="cyan" radius="xl">
						{getInitials(props.review.postedBy?.name || "")}{" "}
					</Avatar>
					<Box>
						<Text>{props.review.postedBy?.name}</Text>
						<Text>
							{DateTime.fromJSDate(
								props.review.postedOn || new Date(),
							).toLocaleString()}
						</Text>
					</Box>
					{user && user.id === props.review.postedBy?.id ? (
						<Anchor
							component={Link}
							href={withQuery(APP_ROUTES.media.postReview, {
								metadataId: props.metadataId,
								metadataGroupId: props.metadataGroupId,
								collectionId: props.collectionId,
								personId: props.personId,
								reviewId: props.review.id,
							})}
						>
							<ActionIcon>
								<IconEdit size={16} />
							</ActionIcon>
						</Anchor>
					) : undefined}
				</Flex>
				<Box ml="sm" mt="xs">
					{typeof props.review.showSeason === "number" ? (
						<Text c="dimmed">
							S{props.review.showSeason}-E
							{props.review.showEpisode}
						</Text>
					) : undefined}
					{typeof props.review.podcastEpisode === "number" ? (
						<Text c="dimmed">EP-{props.review.podcastEpisode}</Text>
					) : undefined}
					{(Number(props.review.rating) || 0) > 0 ? (
						<Flex align="center" gap={4}>
							<IconStarFilled size={16} style={{ color: "#EBE600FF" }} />
							<Text className={classes.text} fw="bold">
								{props.review.rating}
								{userPreferences.data.general.reviewScale ===
								UserReviewScale.OutOfFive
									? undefined
									: "%"}
							</Text>
						</Flex>
					) : undefined}
					{props.review.text ? (
						!props.review.spoiler ? (
							<>
								{/* biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely */}
								<div dangerouslySetInnerHTML={{ __html: props.review.text }} />
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
									<Text
										dangerouslySetInnerHTML={{ __html: props.review.text }}
									/>
								</Collapse>
							</>
						)
					) : undefined}
					<Button
						variant="subtle"
						size="compact-md"
						onClick={() => {
							const comment = prompt("Enter comment");
							if (comment && props.review.id)
								createReviewComment.mutate({
									input: { reviewId: props.review.id, text: comment },
								});
						}}
					>
						Leave comment
					</Button>
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
																if (props.review.id && yes)
																	createReviewComment.mutate({
																		input: {
																			reviewId: props.review.id,
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
															if (props.review.id)
																createReviewComment.mutate({
																	input: {
																		reviewId: props.review.id,
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
	entityLot?: EntityLot | null;
	href?: string;
	lot?: MetadataLot | null;
	children?: JSX.Element;
	imageOverlayForLoadingIndicator?: boolean;
	existsInDatabase?: boolean;
	averageRating?: string;
	noRatingLink?: boolean;
}) => {
	const userPreferences = useUserPreferences();
	const router = useRouter();
	const nextPath = withQuery(router.pathname, router.query);

	return userPreferences.data ? (
		<BaseDisplayItem
			href={
				props.href
					? props.href
					: withQuery(
							match(props.entityLot)
								.with(
									EntityLot.Media,
									undefined,
									null,
									() => APP_ROUTES.media.individualMediaItem.details,
								)
								.with(
									EntityLot.MediaGroup,
									() => APP_ROUTES.media.groups.details,
								)
								.with(EntityLot.Person, () => APP_ROUTES.media.people.details)
								.with(
									EntityLot.Exercise,
									() => APP_ROUTES.fitness.exercises.details,
								)
								.exhaustive(),
							{ id: props.item.identifier },
					  )
			}
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
			bottomRight={changeCase(
				props.lot ? props.lot : props.entityLot ? props.entityLot : "",
			)}
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
		mutationFn: async (variables: AddEntityToCollectionMutationVariables) => {
			const { addEntityToCollection } = await gqlClient.request(
				AddEntityToCollectionDocument,
				variables,
			);
			return addEntityToCollection;
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
			imageOverlayForLoadingIndicator={commitMedia.isPending}
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
							input: {
								collectionName: "Watchlist",
								entityId: id,
								entityLot: EntityLot.Media,
							},
						});
					}}
					disabled={addMediaToCollection.isPending}
				>
					Add to Watchlist
				</Button>
			</>
		</MediaItemWithoutUpdateModal>
	);
};

export const AddEntityToCollectionModal = (props: {
	opened: boolean;
	onClose: () => void;
	entityId: number;
	refetchUserMedia: () => void;
	entityLot: EntityLot;
}) => {
	const [selectedCollection, setSelectedCollection] = useState<string | null>(
		null,
	);

	const collections = useQuery({
		queryKey: ["collections"],
		queryFn: async () => {
			const { userCollectionsList } = await gqlClient.request(
				UserCollectionsListDocument,
				{},
			);
			return userCollectionsList.map((c) => c.name);
		},
	});
	const addMediaToCollection = useMutation({
		mutationFn: async (variables: AddEntityToCollectionMutationVariables) => {
			const { addEntityToCollection } = await gqlClient.request(
				AddEntityToCollectionDocument,
				variables,
			);
			return addEntityToCollection;
		},
		onSuccess: () => {
			props.refetchUserMedia();
			props.onClose();
		},
	});

	return collections.data ? (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			{collections ? (
				<Stack>
					<Title order={3}>Select collection</Title>
					{collections.data.length > 0 ? (
						<Select
							data={collections.data}
							onChange={setSelectedCollection}
							searchable
						/>
					) : undefined}
					<Button
						data-autofocus
						variant="outline"
						onClick={() => {
							addMediaToCollection.mutate({
								input: {
									collectionName: selectedCollection || "",
									entityId: props.entityId,
									entityLot: props.entityLot,
								},
							});
						}}
					>
						Set
					</Button>
					<Button variant="outline" color="red" onClick={props.onClose}>
						Cancel
					</Button>
				</Stack>
			) : undefined}
		</Modal>
	) : undefined;
};

export const DisplayCollection = (props: {
	col: { id: number; name: string };
	entityId: number;
	entityLot: EntityLot;
	refetch: () => void;
}) => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);
	const removeMediaFromCollection = useMutation({
		mutationFn: async (
			variables: RemoveEntityFromCollectionMutationVariables,
		) => {
			const { removeEntityFromCollection } = await gqlClient.request(
				RemoveEntityFromCollectionDocument,
				variables,
			);
			return removeEntityFromCollection;
		},
		onSuccess: () => {
			props.refetch();
		},
	});

	return (
		<Badge
			key={props.col.id}
			color={
				colors[
					// taken from https://stackoverflow.com/questions/44975435/using-mod-operator-in-javascript-to-wrap-around#comment76926119_44975435
					(getStringAsciiValue(props.col.name) + colors.length) % colors.length
				]
			}
		>
			<Flex gap={2}>
				<Anchor
					component={Link}
					truncate
					style={{ all: "unset", cursor: "pointer" }}
					href={withQuery(APP_ROUTES.collections.details, {
						id: props.col.id,
					})}
				>
					{props.col.name}
				</Anchor>
				<ActionIcon
					size={16}
					onClick={() => {
						const yes = confirm(
							"Are you sure you want to remove this media from this collection?",
						);
						if (yes)
							removeMediaFromCollection.mutate({
								input: {
									collectionName: props.col.name,
									entityId: props.entityId,
									entityLot: props.entityLot,
								},
							});
					}}
				>
					<IconX />
				</ActionIcon>
			</Flex>
		</Badge>
	);
};
