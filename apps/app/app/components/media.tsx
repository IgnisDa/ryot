import { $path } from "@ignisda/remix-routes";
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
	Group,
	Image,
	Loader,
	Modal,
	Paper,
	ScrollArea,
	Select,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
	useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	Form,
	Link,
	useFetcher,
	useNavigate,
	useRevalidator,
} from "@remix-run/react";
import {
	CoreDetails,
	EntityLot,
	MetadataLot,
	MetadataSource,
	type PartialMetadata,
	type ReviewItem,
	UserPreferencesQuery,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials } from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconCheck,
	IconEdit,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useRef, useState } from "react";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { useGetMantineColor } from "~/lib/hooks";
import { Verb, getFallbackImageUrl, getVerb } from "~/lib/utilities";
import { ApplicationUser } from "~/lib/utilities.server";
import classes from "~/styles/media-components.module.css";

const commitMedia = async (
	identifier: string,
	lot: MetadataLot,
	source: MetadataSource,
) => {
	const data = new FormData();
	data.append("identifier", identifier);
	data.append("lot", lot);
	data.append("source", source);
	const resp = await fetch("/actions?intent=commitMedia", {
		method: "POST",
		body: data,
	});
	const json = await resp.json();
	return json.commitMedia.id;
};

export const PartialMetadataDisplay = (props: { media: PartialMetadata }) => {
	const navigate = useNavigate();

	return (
		<Anchor
			component={Link}
			data-media-id={props.media.identifier}
			to={
				props.media.metadataId
					? $path("/media/item/:id", { id: props.media.metadataId })
					: $path("/")
			}
			onClick={async (e) => {
				e.preventDefault();
				const id = await commitMedia(
					props.media.identifier,
					props.media.lot,
					props.media.source,
				);
				return navigate($path("/media/item/:id", { id }));
			}}
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

export const MediaScrollArea = (props: {
	children: JSX.Element;
	coreDetails: CoreDetails;
}) => {
	return (
		<ScrollArea.Autosize mah={props.coreDetails.itemDetailsHeight}>
			{props.children}
		</ScrollArea.Autosize>
	);
};

export const ReviewItemDisplay = (props: {
	review: DeepPartial<ReviewItem>;
	user: ApplicationUser;
	userPreferences: UserPreferencesQuery["userPreferences"];
	title: string;
	metadataId?: number;
	metadataGroupId?: number;
	personId?: number;
	collectionId?: number;
}) => {
	const [opened, { toggle }] = useDisclosure(false);
	const [openedLeaveComment, { toggle: toggleLeaveComment }] =
		useDisclosure(false);
	const createReviewCommentFormRef = useRef<HTMLFormElement>(null);
	const createReviewCommentFetcher = useFetcher();
	const deleteReviewCommentFormRef = useRef<HTMLFormElement>(null);
	const deleteReviewCommentFetcher = useFetcher();
	const changeScoreFormRef = useRef<HTMLFormElement>(null);
	const changeScoreFetcher = useFetcher();

	return (
		<>
			<Box key={props.review.id} data-review-id={props.review.id}>
				<Flex align="center" gap="sm">
					<Avatar color="cyan" radius="xl">
						{getInitials(props.review.postedBy?.name || "")}{" "}
					</Avatar>
					<Box>
						<Text>{props.review.postedBy?.name}</Text>
						<Text>
							{DateTime.fromISO(
								props.review.postedOn || new Date().toISOString(),
							).toLocaleString()}
						</Text>
					</Box>
					{props.user && props.user.id === props.review.postedBy?.id ? (
						<Anchor
							component={Link}
							to={$path(
								"/media/:id/post-review",
								{
									id: String(
										props.metadataId ||
											props.metadataGroupId ||
											props.collectionId ||
											props.personId ||
											props.review.id,
									),
								},
								{
									entityType: props.metadataId
										? "metadata"
										: props.metadataGroupId
										  ? "metadataGroup"
										  : props.collectionId
											  ? "collection"
											  : "person",
									existingReviewId: props.review.id,
									title: props.title,
								},
							)}
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
								{props.userPreferences.general.reviewScale ===
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
									<Text
										// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
										dangerouslySetInnerHTML={{ __html: props.review.text }}
									/>
								</Collapse>
							</>
						)
					) : undefined}
					{openedLeaveComment ? (
						<Form
							action="/actions?intent=createReviewComment"
							method="post"
							ref={createReviewCommentFormRef}
						>
							<input hidden name="reviewId" defaultValue={props.review.id} />
							<Group>
								<TextInput
									name="text"
									placeholder="Enter comment"
									style={{ flex: 1 }}
								/>
								<ActionIcon
									color="green"
									onClick={() => {
										createReviewCommentFetcher.submit(
											createReviewCommentFormRef.current,
										);
										toggleLeaveComment();
									}}
								>
									<IconCheck />
								</ActionIcon>
							</Group>
						</Form>
					) : undefined}
					{!openedLeaveComment ? (
						<Button
							variant="subtle"
							size="compact-md"
							onClick={toggleLeaveComment}
							type="submit"
						>
							Leave comment
						</Button>
					) : undefined}
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
															{DateTime.fromISO(
																c?.createdOn || new Date().toISOString(),
															).toLocaleString()}
														</Text>
													</Box>
													{props.user.id === c?.user?.id ? (
														<Form
															action="/actions?intent=createReviewComment"
															method="post"
															ref={deleteReviewCommentFormRef}
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
																onClick={() => {
																	const yes = confirm(
																		"Are you sure you want to delete this comment?",
																	);
																	if (yes)
																		deleteReviewCommentFetcher.submit(
																			deleteReviewCommentFormRef.current,
																		);
																}}
															>
																<IconTrash size={16} />
															</ActionIcon>
														</Form>
													) : undefined}
													<Form
														action="/actions?intent=createReviewComment"
														method="post"
														ref={changeScoreFormRef}
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
															defaultValue={String(
																!c?.likedBy?.includes(props.user.id),
															)}
														/>
														<input
															hidden
															name="decrementLikes"
															defaultValue={String(
																c?.likedBy?.includes(props.user.id),
															)}
														/>
														<ActionIcon
															onClick={() => {
																changeScoreFetcher.submit(
																	changeScoreFormRef.current,
																);
															}}
														>
															<IconArrowBigUp size={16} />
															<Text>{c?.likedBy?.length}</Text>
														</ActionIcon>
													</Form>
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
	);
};

export const BaseDisplayItem = (props: {
	name: string;
	onClick?: (e: React.MouseEvent) => Promise<void>;
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
				to={props.href}
				style={{ flex: "none" }}
				pos="relative"
				onClick={props.onClick}
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
			<Flex w="100%" direction="column" px={{ base: 10, md: 3 }} py={4}>
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
	userPreferences: UserPreferencesQuery["userPreferences"];
	entityLot?: EntityLot | null;
	href?: string;
	lot?: MetadataLot | null;
	children?: JSX.Element;
	imageOverlayForLoadingIndicator?: boolean;
	hasInteracted?: boolean;
	averageRating?: string;
	noRatingLink?: boolean;
	onClick?: (e: React.MouseEvent) => Promise<void>;
}) => {
	const navigate = useNavigate();

	return (
		<BaseDisplayItem
			onClick={props.onClick}
			href={
				props.href
					? props.href
					: match(props.entityLot)
							.with(EntityLot.Media, undefined, null, () =>
								$path("/media/item/:id", { id: props.item.identifier }),
							)
							.with(EntityLot.MediaGroup, () =>
								$path("/media/groups/:id", { id: props.item.identifier }),
							)
							.with(EntityLot.Person, () =>
								$path("/media/people/:id", { id: props.item.identifier }),
							)
							.with(EntityLot.Exercise, () =>
								$path("/fitness/exercises/:id", { id: props.item.identifier }),
							)
							.exhaustive()
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
								{match(props.userPreferences.general.reviewScale)
									.with(UserReviewScale.OutOfFive, () =>
										// biome-ignore lint/style/noNonNullAssertion: it is validated above
										parseFloat(props.averageRating!.toString()).toFixed(1),
									)
									.with(UserReviewScale.OutOfHundred, () => props.averageRating)
									.exhaustive()}{" "}
								{props.userPreferences.general.reviewScale ===
								UserReviewScale.OutOfFive
									? undefined
									: "%"}
							</Text>
						</Flex>
					</Box>
				) : props.noRatingLink ? undefined : (
					<Box
						p={3}
						pos="absolute"
						top={5}
						right={5}
						style={{
							backgroundColor: "rgba(0, 0, 0, 0.75)",
							borderRadius: 3,
						}}
						onClick={(e) => {
							e.preventDefault();
							navigate(
								$path(
									"/media/:id/post-review",
									{ id: props.item.identifier },
									{
										entityType: "metadata",
										title: props.item.title,
										isShow: props.lot === MetadataLot.Show,
										isPodcast: props.lot === MetadataLot.Podcast,
									},
								),
							);
						}}
					>
						<Flex align="center" gap={4}>
							<IconStarFilled size={16} className={classes.starIcon} />
						</Flex>
					</Box>
				)
			}
			bottomLeft={props.item.publishYear}
			bottomRight={changeCase(
				props.lot ? props.lot : props.entityLot ? props.entityLot : "",
			)}
			highlightRightText={
				props.hasInteracted ? "This media exists in the database" : undefined
			}
			name={props.item.title}
			children={props.children}
		/>
	);
};

export const MediaSearchItem = (props: {
	item: Item;
	idx: number;
	query: string;
	lot: MetadataLot;
	source: MetadataSource;
	userPreferences: UserPreferencesQuery["userPreferences"];
	action: "search" | "list";
	hasInteracted: boolean;
	maybeItemId?: number;
}) => {
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);
	const revalidator = useRevalidator();
	const basicCommit = async (e: React.MouseEvent) => {
		if (props.maybeItemId) return props.maybeItemId;
		e.preventDefault();
		return await commitMedia(props.item.identifier, props.lot, props.source);
	};

	return (
		<MediaItemWithoutUpdateModal
			item={props.item}
			lot={props.lot}
			userPreferences={props.userPreferences}
			hasInteracted={props.hasInteracted}
			imageOverlayForLoadingIndicator={isLoading}
			noRatingLink
			onClick={async (e) => {
				setIsLoading(true);
				const id = await basicCommit(e);
				setIsLoading(false);
				return navigate($path("/media/item/:id", { id }));
			}}
		>
			<>
				{props.lot !== MetadataLot.Show ? (
					<Button
						variant="outline"
						w="100%"
						size="compact-md"
						onClick={async (e) => {
							const id = await basicCommit(e);
							return navigate(
								$path(
									"/media/item/:id/update-progress",
									{ id },
									{
										title: props.item.title,
										redirectTo: $path(
											"/media/:action/:lot",
											{
												action: props.action,
												lot: props.lot.toLowerCase(),
											},
											{ query: props.query },
										),
									},
								),
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
							onClick={async (e) => {
								const id = await basicCommit(e);
								return navigate($path("/media/item/:id", { id }));
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
						setIsLoading(true);
						const id = await commitMedia(
							props.item.identifier,
							props.lot,
							props.source,
						);
						const form = new FormData();
						form.append("intent", "addEntityToCollection");
						form.append("entityId", id);
						form.append("entityLot", EntityLot.Media);
						form.append("collectionName", "Watchlist");
						await fetch($path("/actions"), {
							body: form,
							method: "POST",
							credentials: "include",
						});
						setIsLoading(false);
						revalidator.revalidate();
					}}
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
	entityId: string;
	entityLot: EntityLot;
	collections: string[];
}) => {
	const addEntityToCollectionFormRef = useRef<HTMLFormElement>(null);
	const addEntityToCollectionFetcher = useFetcher();

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form
				action="/actions?intent=addEntityToCollection"
				method="post"
				ref={addEntityToCollectionFormRef}
			>
				<input hidden name="entityId" defaultValue={props.entityId} />
				<input hidden name="entityLot" defaultValue={props.entityLot} />
				<Stack>
					<Title order={3}>Select collection</Title>
					<Select data={props.collections} searchable name="collectionName" />
					<Button
						data-autofocus
						variant="outline"
						onClick={() => {
							addEntityToCollectionFetcher.submit(
								addEntityToCollectionFormRef.current,
							);
							props.onClose();
						}}
					>
						Set
					</Button>
					<Button variant="outline" color="red" onClick={props.onClose}>
						Cancel
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};

export const DisplayCollection = (props: {
	col: { id: number; name: string };
	entityId: string;
	entityLot: EntityLot;
}) => {
	const getMantineColor = useGetMantineColor();
	const removeEntityFromCollectionFormRef = useRef<HTMLFormElement>(null);
	const removeEntityFromCollection = useFetcher();

	return (
		<Badge key={props.col.id} color={getMantineColor(props.col.name)}>
			<Form
				action="/actions?intent=removeEntityFromCollection"
				method="post"
				ref={removeEntityFromCollectionFormRef}
			>
				<Flex gap={2}>
					<Anchor
						component={Link}
						truncate
						style={{ all: "unset", cursor: "pointer" }}
						to={$path("/media/collections/:id", {
							id: props.col.id,
						})}
					>
						{props.col.name}
					</Anchor>
					<input hidden name="entityId" defaultValue={props.entityId} />
					<input hidden name="entityLot" defaultValue={props.entityLot} />
					<input hidden name="collectionName" defaultValue={props.col.name} />
					<ActionIcon
						size={16}
						onClick={() => {
							const yes = confirm(
								"Are you sure you want to remove this media from this collection?",
							);
							if (yes)
								removeEntityFromCollection.submit(
									removeEntityFromCollectionFormRef.current,
								);
						}}
					>
						<IconX />
					</ActionIcon>
				</Flex>
			</Form>
		</Badge>
	);
};
