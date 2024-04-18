import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Alert,
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
	Menu,
	Modal,
	NumberInput,
	Paper,
	Rating,
	ScrollArea,
	SegmentedControl,
	SimpleGrid,
	Stack,
	type StyleProp,
	Text,
	TextInput,
	Textarea,
	Title,
	Tooltip,
	useComputedColorScheme,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import "@mantine/dates/styles.css";
import { useDisclosure } from "@mantine/hooks";
import {
	Form,
	Link,
	useFetcher,
	useNavigate,
	useSubmit,
} from "@remix-run/react";
import {
	EntityLot,
	MediaLot,
	type MediaSource,
	type PartialMetadata,
	type ReviewItem,
	type UserMediaReminderPartFragment,
	UserReviewScale,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatDateToNaiveDate, getInitials } from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconArrowBigUp,
	IconArrowsRight,
	IconBackpack,
	IconCheck,
	IconCloudDownload,
	IconEdit,
	IconPercentage,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { withQuery, withoutHost } from "ufo";
import events from "~/lib/events";
import {
	dayjsLib,
	getFallbackImageUrl,
	redirectToQueryParam,
} from "~/lib/generals";
import { useGetMantineColor } from "~/lib/hooks";
import type { ApplicationUser } from "~/lib/utilities.server";
import classes from "~/styles/common.module.css";
import { HiddenLocationInput } from "./common";
import { confirmWrapper } from "./confirmation";

export const commitMedia = async (
	identifier: string,
	lot: MediaLot,
	source: MediaSource,
) => {
	const data = new FormData();
	const location = withoutHost(window.location.href);
	data.append("identifier", identifier);
	data.append("lot", lot);
	data.append("source", source);
	data.append(redirectToQueryParam, location);
	const resp = await fetch(withQuery("/actions", { intent: "commitMedia" }), {
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
	lot?: MediaLot;
}) => {
	const [opened, { toggle }] = useDisclosure(false);
	const [openedLeaveComment, { toggle: toggleLeaveComment }] =
		useDisclosure(false);
	const [postReviewModalData, setPostReviewModalData] = useState<
		PostReview | undefined
	>(undefined);
	const deleteReviewFetcher = useFetcher();

	const submit = useSubmit();

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
												[redirectToQueryParam]: withoutHost(
													window.location.href,
												),
												shouldDelete: "true",
												reviewId: props.review.id?.toString(),
												// biome-ignore lint/suspicious/noExplicitAny: otherwise an error here
											} as any,
											{
												method: "post",
												action: withQuery("/actions", {
													intent: "performReviewAction",
												}),
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
						<Form
							action="/actions?intent=createReviewComment"
							method="post"
							onSubmit={() => toggleLeaveComment()}
						>
							<input hidden name="reviewId" defaultValue={props.review.id} />
							<HiddenLocationInput />
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
													{props.user.id === c?.user?.id ? (
														<Form
															action="/actions?intent=createReviewComment"
															method="post"
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
															<HiddenLocationInput />
															<ActionIcon
																color="red"
																type="submit"
																onClick={async (e) => {
																	const form = e.currentTarget.form;
																	e.preventDefault();
																	const conf = await confirmWrapper({
																		confirmation:
																			"Are you sure you want to delete this comment?",
																	});
																	if (conf) submit(form);
																}}
															>
																<IconTrash size={16} />
															</ActionIcon>
														</Form>
													) : null}
													<Form
														action="/actions?intent=createReviewComment"
														method="post"
													>
														<HiddenLocationInput />
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
																!c?.likedBy?.includes(props.user.id),
															)}
															readOnly
														/>
														<input
															hidden
															name="decrementLikes"
															value={String(
																c?.likedBy?.includes(props.user.id),
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
	href?: string;
	highlightRightText?: string;
	children?: ReactNode;
	nameRight?: JSX.Element;
}) => {
	const colorScheme = useComputedColorScheme("dark");

	const SurroundingElement = (iProps: {
		children: ReactNode;
		style: React.CSSProperties;
		pos: StyleProp<React.CSSProperties["position"]>;
	}) =>
		props.href ? (
			<Anchor
				component={Link}
				to={props.href}
				style={iProps.style}
				pos={iProps.pos}
			>
				{iProps.children}
			</Anchor>
		) : (
			<Box onClick={props.onClick} style={iProps.style} pos={iProps.pos}>
				{iProps.children}
			</Box>
		);

	return (
		<Flex
			key={`${props.bottomLeft}-${props.bottomRight}-${props.name}`}
			align="center"
			justify="center"
			direction="column"
			pos="relative"
		>
			{props.topLeft}
			<SurroundingElement style={{ flex: "none" }} pos="relative">
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
			</SurroundingElement>
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
				<Flex justify="space-between" align="center" mb="xs">
					<Tooltip label={props.name} position="top">
						<Text w="100%" truncate fw="bold">
							{props.name}
						</Text>
					</Tooltip>
					{props.nameRight}
				</Flex>
				{props.children}
			</Flex>
		</Flex>
	);
};

export type Item = {
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
	lot?: MediaLot | null;
	children?: ReactNode;
	imageOverlayForLoadingIndicator?: boolean;
	hasInteracted?: boolean;
	averageRating?: string;
	noRatingLink?: boolean;
	noBottomRight?: boolean;
	noHref?: boolean;
	onClick?: (e: React.MouseEvent) => Promise<void>;
	nameRight?: JSX.Element;
}) => {
	const navigate = useNavigate();

	return (
		<BaseDisplayItem
			onClick={props.onClick}
			href={
				!props.noHref
					? props.href
						? props.href
						: match(props.entityLot)
								.with(EntityLot.Media, undefined, null, () =>
									$path("/media/item/:id", { id: props.item.identifier }),
								)
								.with(EntityLot.MediaGroup, () =>
									$path("/media/groups/item/:id", {
										id: props.item.identifier,
									}),
								)
								.with(EntityLot.Person, () =>
									$path("/media/people/item/:id", {
										id: props.item.identifier,
									}),
								)
								.with(EntityLot.Exercise, () =>
									$path("/fitness/exercises/:id", {
										id: props.item.identifier,
									}),
								)
								.with(EntityLot.Collection, () =>
									$path("/collections/:id", { id: props.item.identifier }),
								)
								.exhaustive()
					: undefined
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
										Number.parseFloat(props.averageRating!.toString()).toFixed(
											1,
										),
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
			nameRight={props.nameRight}
			children={props.children}
		/>
	);
};

export const DisplayCollection = (props: {
	col: { id: number; name: string };
	entityId: string;
	entityLot: EntityLot;
}) => {
	const getMantineColor = useGetMantineColor();
	const submit = useSubmit();

	return (
		<Badge key={props.col.id} color={getMantineColor(props.col.name)}>
			<Form action="/actions?intent=removeEntityFromCollection" method="post">
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
					<HiddenLocationInput />
					<ActionIcon
						size={16}
						onClick={async (e) => {
							const form = e.currentTarget.form;
							e.preventDefault();
							const conf = await confirmWrapper({
								confirmation:
									"Are you sure you want to remove this media from this collection?",
							});
							if (conf) submit(form);
						}}
					>
						<IconX />
					</ActionIcon>
				</Flex>
			</Form>
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
	lot?: MediaLot;
}) => {
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
				action="/actions?intent=performReviewAction"
				replace
				onSubmit={() => {
					events.postReview(props.title);
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
				<HiddenLocationInput />
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
					{props.lot === MediaLot.Show ? (
						<Flex gap="md">
							<NumberInput
								label="Season"
								name="showSeasonNumber"
								hideControls
								defaultValue={
									typeof props.data?.existingReview?.showExtraInformation
										?.season === "number"
										? props.data.existingReview.showExtraInformation?.season
										: typeof props.data.showSeasonNumber === "number"
										  ? props.data.showSeasonNumber
										  : undefined
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
					{props.lot === MediaLot.Podcast ? (
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
					{props.lot === MediaLot.Anime ? (
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
					{props.lot === MediaLot.Manga ? (
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

export const NewUserGuideAlert = () => {
	return (
		<Alert icon={<IconArrowsRight />} variant="outline" color="teal">
			<Text>
				To get started, select a media type from the sidebar, enter a query in
				the search tab, and add a media to your seen history or watchlist.
			</Text>
			<Text mt="xs">
				This notice will disappear once your summary is re-calculated.
			</Text>
		</Alert>
	);
};

export const MediaIsPartial = (props: { mediaType: string }) => {
	return (
		<Flex align="center" gap={4}>
			<IconCloudDownload size={20} />
			<Text size="xs">
				Details of this {props.mediaType} are being downloaded
			</Text>
		</Flex>
	);
};

export const CreateReminderModal = (props: {
	opened: boolean;
	onClose: () => void;
	defaultText: string;
	metadataId?: number;
	personId?: number;
	metadataGroupId?: number;
}) => {
	const [remindOn, setRemindOn] = useState(dayjsLib().add(1, "day").toDate());

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form method="post" action="/actions?intent=createMediaReminder">
				<input
					hidden
					name="remindOn"
					value={formatDateToNaiveDate(remindOn)}
					readOnly
				/>
				<HiddenLocationInput />
				<Stack>
					<Title order={3}>Create a reminder</Title>
					<Text>
						A notification will be sent to all your configured{" "}
						<Anchor to={$path("/settings/notifications")} component={Link}>
							platforms
						</Anchor>
						.
					</Text>
					<TextInput
						name="message"
						label="Message"
						required
						defaultValue={props.defaultText}
					/>
					<DateInput
						label="Remind on"
						popoverProps={{ withinPortal: true }}
						required
						onChange={(v) => {
							if (v) setRemindOn(v);
						}}
						value={remindOn}
					/>
					<input
						hidden
						name={
							props.metadataId
								? "metadataId"
								: props.personId
								  ? "personId"
								  : "metadataGroupId"
						}
						value={props.metadataId || props.personId || props.metadataGroupId}
						readOnly
					/>
					<Button
						data-autofocus
						variant="outline"
						onClick={() => props.onClose()}
						type="submit"
					>
						Submit
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};

export const DisplayMediaReminder = (props: {
	reminderData: UserMediaReminderPartFragment;
}) => {
	return (
		<Alert icon={<IconAlertCircle />} variant="outline" color="violet">
			Reminder for {props.reminderData.remindOn}
			<Text c="green">{props.reminderData.message}</Text>
		</Alert>
	);
};

export const DisplayMediaOwned = () => {
	return (
		<Flex align="center" gap={2}>
			<IconBackpack size={20} />
			<Text size="xs">You own this media</Text>
		</Flex>
	);
};

export const CreateOwnershipModal = (props: {
	opened: boolean;
	metadataId?: number;
	metadataGroupId?: number;
	onClose: () => void;
}) => {
	const [ownedOn, setOwnedOn] = useState<Date | null>();

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form
				method="post"
				action="/actions?intent=toggleMediaOwnership"
				replace
				onSubmit={() => events.markAsOwned()}
			>
				<HiddenLocationInput />
				<Stack>
					<Title order={3}>Mark media as owned</Title>
					<DateInput
						label="When did you get this media?"
						clearable
						popoverProps={{ withinPortal: true }}
						onChange={setOwnedOn}
						value={ownedOn}
					/>
					{props.metadataId ? (
						<input hidden name="metadataId" defaultValue={props.metadataId} />
					) : null}
					{props.metadataGroupId ? (
						<input
							hidden
							name="metadataGroupId"
							defaultValue={props.metadataGroupId}
						/>
					) : null}
					<input
						hidden
						name="ownedOn"
						value={ownedOn ? formatDateToNaiveDate(ownedOn) : undefined}
					/>
					<SimpleGrid cols={2}>
						<Button
							variant="outline"
							onClick={props.onClose}
							disabled={!!ownedOn}
							data-autofocus
							type="submit"
						>
							I don't remember
						</Button>
						<Button
							disabled={!ownedOn}
							variant="outline"
							type="submit"
							onClick={props.onClose}
						>
							Submit
						</Button>
					</SimpleGrid>
				</Stack>
			</Form>
		</Modal>
	);
};

export const ToggleMediaMonitorMenuItem = (props: {
	entityLot: EntityLot;
	inCollections: string[];
	formValue: number;
}) => {
	const isMonitored = props.inCollections.includes("Monitoring");
	const action = isMonitored
		? "removeEntityFromCollection"
		: "addEntityToCollection";

	return (
		<Form action={`/actions?intent=${action}`} method="post" replace>
			<HiddenLocationInput />
			<input hidden name="collectionName" value="Monitoring" />
			<input hidden name="entityLot" value={props.entityLot} />
			<Menu.Item
				type="submit"
				color={isMonitored ? "red" : undefined}
				name="entityId"
				value={props.formValue}
				onClick={(e) => {
					if (isMonitored)
						if (!confirm("Are you sure you want to stop monitoring?"))
							e.preventDefault();
				}}
			>
				{isMonitored ? "Stop" : "Start"} monitoring
			</Menu.Item>
		</Form>
	);
};
