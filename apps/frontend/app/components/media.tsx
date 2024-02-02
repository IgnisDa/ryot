import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Badge,
	Box,
	Button,
	Checkbox,
	Collapse,
	Divider,
	Flex,
	Group,
	Image,
	Input,
	Loader,
	Modal,
	NumberInput,
	Paper,
	Rating,
	ScrollArea,
	SegmentedControl,
	Select,
	Stack,
	Text,
	TextInput,
	Textarea,
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
	EntityLot,
	MetadataLot,
	MetadataSource,
	type PartialMetadata,
	type ReviewItem,
	UserReviewScale,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials } from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconCheck,
	IconEdit,
	IconPercentage,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { ReactNode, useRef, useState } from "react";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import events from "~/lib/events";
import { Verb, dayjsLib, getFallbackImageUrl, getVerb } from "~/lib/generals";
import { useGetMantineColor } from "~/lib/hooks";
import { ApplicationUser } from "~/lib/utilities.server";
import classes from "~/styles/common.module.css";
import { confirmWrapper } from "./confirmation";

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
				props.media.id
					? $path("/media/item/:id", { id: props.media.id })
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
	children: ReactNode;
	itemDetailsHeight: number;
}) => {
	return (
		<ScrollArea.Autosize mah={props.itemDetailsHeight}>
			{props.children}
		</ScrollArea.Autosize>
	);
};

export const ReviewItemDisplay = (props: {
	review: DeepPartial<ReviewItem>;
	entityType: EntityType;
	user: ApplicationUser;
	reviewScale: UserReviewScale;
	title: string;
	metadataId?: number;
	metadataGroupId?: number;
	personId?: number;
	collectionId?: number;
	lot?: MetadataLot;
}) => {
	const [opened, { toggle }] = useDisclosure(false);
	const [openedLeaveComment, { toggle: toggleLeaveComment }] =
		useDisclosure(false);
	const [postReviewModalData, setPostReviewModalData] = useState<
		PostReview | undefined
	>(undefined);
	const createReviewCommentFormRef = useRef<HTMLFormElement>(null);
	const createReviewCommentFetcher = useFetcher();
	const deleteReviewCommentFormRef = useRef<HTMLFormElement>(null);
	const deleteReviewCommentFetcher = useFetcher();
	const changeScoreFormRef = useRef<HTMLFormElement>(null);
	const changeScoreFetcher = useFetcher();
	const deleteReviewFetcher = useFetcher();

	return (
		<>
			<PostReviewModal
				onClose={() => setPostReviewModalData(undefined)}
				opened={postReviewModalData !== undefined}
				data={postReviewModalData}
				entityType={props.entityType}
				objectId={
					props.metadataId ||
					props.metadataGroupId ||
					props.collectionId ||
					props.personId ||
					-1
				}
				reviewScale={props.reviewScale}
				title={props.title}
				lot={props.lot}
			/>
			<Box key={props.review.id} data-review-id={props.review.id}>
				<Flex align="center" gap="sm">
					<Avatar color="cyan" radius="xl">
						{getInitials(props.review.postedBy?.name || "")}{" "}
					</Avatar>
					<Box>
						<Text>{props.review.postedBy?.name}</Text>
						<Text>{dayjsLib(props.review.postedOn).format("L")}</Text>
					</Box>
					{props.user && props.user.id === props.review.postedBy?.id ? (
						<>
							<ActionIcon
								onClick={() => {
									setPostReviewModalData({
										existingReview: props.review,
										showSeasonNumber: props.review.showExtraInformation?.season,
										showEpisodeNumber:
											props.review.showExtraInformation?.episode,
										podcastEpisodeNumber:
											props.review.podcastExtraInformation?.episode,
										animeEpisodeNumber:
											props.review.animeExtraInformation?.episode,
										mangaChapterNumber:
											props.review.mangaExtraInformation?.chapter,
									});
								}}
							>
								<IconEdit size={16} />
							</ActionIcon>
							<ActionIcon
								onClick={async () => {
									const conf = await confirmWrapper({
										confirmation:
											"Are you sure you want to delete this review? This action cannot be undone.",
									});
									if (conf)
										deleteReviewFetcher.submit(
											{
												shouldDelete: "true",
												reviewId: props.review.id?.toString(),
												// biome-ignore lint/suspicious/noExplicitAny: otherwise an error here
											} as any,
											{
												method: "post",
												action: "/actions?intent=performReviewAction",
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
				<Box ml="sm" mt="xs">
					{typeof props.review.showExtraInformation?.season === "number" ? (
						<Text c="dimmed">
							S{props.review.showExtraInformation.season}-E
							{props.review.showExtraInformation.episode}
						</Text>
					) : null}
					{typeof props.review.podcastExtraInformation?.episode === "number" ? (
						<Text c="dimmed">
							EP-{props.review.podcastExtraInformation.episode}
						</Text>
					) : null}
					{typeof props.review.animeExtraInformation?.episode === "number" ? (
						<Text c="dimmed">
							EP-{props.review.animeExtraInformation.episode}
						</Text>
					) : null}
					{typeof props.review.mangaExtraInformation?.chapter === "number" ? (
						<Text c="dimmed">
							Ch-{props.review.mangaExtraInformation.chapter}
						</Text>
					) : null}
					{(Number(props.review.rating) || 0) > 0 ? (
						<Flex align="center" gap={4}>
							<IconStarFilled size={16} style={{ color: "#EBE600FF" }} />
							<Text className={classes.text} fw="bold">
								{props.review.rating}
								{props.reviewScale === UserReviewScale.OutOfFive
									? undefined
									: "%"}
							</Text>
						</Flex>
					) : null}
					{props.review.textRendered ? (
						!props.review.spoiler ? (
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
						<createReviewCommentFetcher.Form
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
						</createReviewCommentFetcher.Form>
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
													{props.user.id === c?.user?.id ? (
														<deleteReviewCommentFetcher.Form
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
																onClick={async () => {
																	const conf = await confirmWrapper({
																		confirmation:
																			"Are you sure you want to delete this comment?",
																	});
																	if (conf)
																		deleteReviewCommentFetcher.submit(
																			deleteReviewCommentFormRef.current,
																		);
																}}
															>
																<IconTrash size={16} />
															</ActionIcon>
														</deleteReviewCommentFetcher.Form>
													) : null}
													<changeScoreFetcher.Form
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
													</changeScoreFetcher.Form>
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
			<Divider />
		</>
	);
};

export const BaseDisplayItem = (props: {
	name: string;
	onClick?: (e: React.MouseEvent) => Promise<void>;
	imageLink?: string | null;
	imagePlaceholder: string;
	topRight?: ReactNode;
	topLeft?: ReactNode;
	bottomLeft?: string | number | null;
	bottomRight?: string | number | null;
	href: string;
	highlightRightText?: string;
	children?: ReactNode;
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
	reviewScale: UserReviewScale;
	entityLot?: EntityLot | null;
	href?: string;
	lot?: MetadataLot | null;
	children?: ReactNode;
	imageOverlayForLoadingIndicator?: boolean;
	hasInteracted?: boolean;
	averageRating?: string;
	noRatingLink?: boolean;
	noBottomRight?: boolean;
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
							.with(EntityLot.Collection, () =>
								$path("/collections/:id", { id: props.item.identifier }),
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
				) : null
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
								{match(props.reviewScale)
									.with(UserReviewScale.OutOfFive, () =>
										// biome-ignore lint/style/noNonNullAssertion: it is validated above
										parseFloat(props.averageRating!.toString()).toFixed(1),
									)
									.with(UserReviewScale.OutOfHundred, () => props.averageRating)
									.exhaustive()}{" "}
								{props.reviewScale === UserReviewScale.OutOfFive
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
									"/media/item/:id",
									{ id: props.item.identifier },
									{ openReviewModal: true },
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
			bottomRight={
				props.noBottomRight
					? undefined
					: changeCase(
							props.lot ? props.lot : props.entityLot ? props.entityLot : "",
					  )
			}
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
	action: "search" | "list";
	hasInteracted: boolean;
	reviewScale: UserReviewScale;
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
			reviewScale={props.reviewScale}
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
				<Button
					variant="outline"
					w="100%"
					size="compact-md"
					onClick={async (e) => {
						const id = await basicCommit(e);
						return navigate(
							$path(
								"/media/item/:id",
								{ id },
								props.lot !== MetadataLot.Show
									? { defaultTab: "actions", openProgressModal: true }
									: { defaultTab: "seasons" },
							),
						);
					}}
				>
					{props.lot !== MetadataLot.Show
						? `Mark as ${getVerb(Verb.Read, props.lot)}`
						: "Show details"}
				</Button>
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
			<addEntityToCollectionFetcher.Form
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
			</addEntityToCollectionFetcher.Form>
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
			<removeEntityFromCollection.Form
				action="/actions?intent=removeEntityFromCollection"
				method="post"
				ref={removeEntityFromCollectionFormRef}
			>
				<Flex gap={2}>
					<Anchor
						component={Link}
						truncate
						style={{ all: "unset", cursor: "pointer" }}
						to={$path("/collections/:id", {
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
						onClick={async () => {
							const conf = await confirmWrapper({
								confirmation:
									"Are you sure you want to remove this media from this collection?",
							});
							if (conf)
								removeEntityFromCollection.submit(
									removeEntityFromCollectionFormRef.current,
								);
						}}
					>
						<IconX />
					</ActionIcon>
				</Flex>
			</removeEntityFromCollection.Form>
		</Badge>
	);
};

export type PostReview = {
	showSeasonNumber?: number | null;
	showEpisodeNumber?: number | null;
	animeEpisodeNumber?: number | null;
	mangaChapterNumber?: number | null;
	podcastEpisodeNumber?: number | null;
	existingReview?: DeepPartial<ReviewItem>;
};

type EntityType = "metadata" | "metadataGroup" | "collection" | "person";

export const PostReviewModal = (props: {
	opened: boolean;
	onClose: () => void;
	objectId: number;
	entityType: EntityType;
	title: string;
	reviewScale: UserReviewScale;
	data?: PostReview;
	lot?: MetadataLot;
}) => {
	const fetcher = useFetcher();
	const formRef = useRef<HTMLFormElement>(null);

	if (!props.data) return <></>;
	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form
				method="post"
				ref={formRef}
				action="/actions?intent=performReviewAction"
				replace
				onSubmit={(e) => {
					e.preventDefault();
					events.postReview(props.title);
					fetcher.submit(formRef.current);
					props.onClose();
				}}
			>
				<input
					hidden
					name={
						props.entityType === "metadata"
							? "metadataId"
							: props.entityType === "metadataGroup"
							  ? "metadataGroupId"
							  : props.entityType === "collection"
								  ? "collectionId"
								  : props.entityType === "person"
									  ? "personId"
									  : undefined
					}
					value={props.objectId}
					readOnly
				/>
				{props.data.existingReview?.id ? (
					<input hidden name="reviewId" value={props.data.existingReview.id} />
				) : null}
				<Stack>
					<Flex align="center" gap="xl">
						{match(props.reviewScale)
							.with(UserReviewScale.OutOfFive, () => (
								<Flex gap="sm" mt="lg">
									<Input.Label>Rating:</Input.Label>
									<Rating
										name="rating"
										defaultValue={
											props.data?.existingReview?.rating
												? Number(props.data.existingReview.rating)
												: undefined
										}
										fractions={2}
									/>
								</Flex>
							))
							.with(UserReviewScale.OutOfHundred, () => (
								<NumberInput
									label="Rating"
									name="rating"
									min={0}
									max={100}
									step={1}
									w="40%"
									hideControls
									rightSection={<IconPercentage size={16} />}
									defaultValue={
										props.data?.existingReview?.rating
											? Number(props.data.existingReview.rating)
											: undefined
									}
								/>
							))
							.exhaustive()}
						<Checkbox label="This review is a spoiler" mt="lg" name="spoiler" />
					</Flex>
					{props.lot === MetadataLot.Show ? (
						<Flex gap="md">
							<NumberInput
								label="Season"
								name="showSeasonNumber"
								hideControls
								defaultValue={
									props.data?.existingReview?.showExtraInformation?.season
										? props.data.existingReview.showExtraInformation?.season
										: props.data.showSeasonNumber || undefined
								}
							/>
							<NumberInput
								label="Episode"
								name="showEpisodeNumber"
								hideControls
								defaultValue={
									props.data?.existingReview?.showExtraInformation?.episode
										? props.data.existingReview.showExtraInformation?.episode
										: props.data.showEpisodeNumber || undefined
								}
							/>
						</Flex>
					) : null}
					{props.lot === MetadataLot.Podcast ? (
						<NumberInput
							label="Episode"
							name="podcastEpisodeNumber"
							hideControls
							defaultValue={
								props.data?.existingReview?.podcastExtraInformation?.episode
									? props.data.existingReview.podcastExtraInformation?.episode
									: props.data.podcastEpisodeNumber || undefined
							}
						/>
					) : null}
					{props.lot === MetadataLot.Anime ? (
						<NumberInput
							label="Episode"
							name="animeEpisodeNumber"
							hideControls
							defaultValue={
								props.data?.existingReview?.animeExtraInformation?.episode
									? props.data.existingReview.animeExtraInformation?.episode
									: props.data.animeEpisodeNumber || undefined
							}
						/>
					) : null}
					{props.lot === MetadataLot.Manga ? (
						<NumberInput
							label="Chapter"
							name="mangaChapterNumber"
							hideControls
							defaultValue={
								props.data?.existingReview?.mangaExtraInformation?.chapter
									? props.data.existingReview.mangaExtraInformation?.chapter
									: props.data.mangaChapterNumber || undefined
							}
						/>
					) : null}
					<Textarea
						label="Review"
						name="text"
						description="Markdown is supported"
						autoFocus
						minRows={10}
						maxRows={20}
						autosize
						defaultValue={props.data.existingReview?.textOriginal ?? undefined}
					/>
					<Box>
						<Input.Label>Visibility</Input.Label>
						<SegmentedControl
							fullWidth
							data={[
								{
									label: Visibility.Public,
									value: Visibility.Public,
								},
								{
									label: Visibility.Private,
									value: Visibility.Private,
								},
							]}
							defaultValue={
								props.data.existingReview?.visibility ?? Visibility.Public
							}
							name="visibility"
						/>
					</Box>
					<Button mt="md" type="submit" w="100%">
						{props.data.existingReview?.id ? "Update" : "Submit"}
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};
