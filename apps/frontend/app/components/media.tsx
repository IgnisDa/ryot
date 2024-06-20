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
	type MantineStyleProp,
	Menu,
	Modal,
	NumberInput,
	Paper,
	Rating,
	ScrollArea,
	SegmentedControl,
	Stack,
	type StyleProp,
	Text,
	TextInput,
	Textarea,
	ThemeIcon,
	Tooltip,
	useComputedColorScheme,
} from "@mantine/core";
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
	UserReviewScale,
	UserToMediaReason,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials } from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconArrowsRight,
	IconBackpack,
	IconBookmarks,
	IconCheck,
	IconCloudDownload,
	IconEdit,
	IconPercentage,
	IconRosetteDiscountCheck,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import { HiddenLocationInput } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import events from "~/lib/events";
import {
	dayjsLib,
	getFallbackImageUrl,
	redirectToQueryParam,
} from "~/lib/generals";
import { useGetMantineColor } from "~/lib/hooks";
import type { ApplicationUser } from "~/lib/utilities.server";
import type { action } from "~/routes/actions";
import classes from "~/styles/common.module.css";

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
	const resp = await fetch($path("/actions", { intent: "commitMedia" }), {
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

export const MediaScrollArea = (props: { children: ReactNode }) => {
	return (
		<ScrollArea.Autosize mah={{ base: "45vh", "2xl": "55vh" }}>
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
	metadataId?: string;
	metadataGroupId?: string;
	personId?: string;
	collectionId?: string;
	lot?: MediaLot;
}) => {
	const [opened, { toggle }] = useDisclosure(false);
	const [openedLeaveComment, { toggle: toggleLeaveComment }] =
		useDisclosure(false);
	const [postReviewModalData, setPostReviewModalData] = useState<
		PostReview | undefined
	>(undefined);
	const deleteReviewFetcher = useFetcher<typeof action>();

	const submit = useSubmit();

	return (
		<>
			<PostReviewModal
				onClose={() => setPostReviewModalData(undefined)}
				opened={postReviewModalData !== undefined}
				data={postReviewModalData}
				entityType={props.entityType}
				objectId={
					props.metadataId?.toString() ||
					props.metadataGroupId?.toString() ||
					props.collectionId?.toString() ||
					props.personId?.toString() ||
					""
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
										mangaVolumeNumber:
											props.review.mangaExtraInformation?.volume,
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
												action: $path("/actions", {
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
					{typeof props.review.mangaExtraInformation?.volume === "number" ? (
						<Text c="dimmed">
							VOL-{props.review.mangaExtraInformation.volume}
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

const blackBgStyles = {
	backgroundColor: "rgba(0, 0, 0, 0.75)",
	borderRadius: 3,
	padding: 2,
} satisfies MantineStyleProp;

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
	mediaReason?: Array<UserToMediaReason> | null;
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

	const reasons = props.mediaReason?.filter((r) =>
		[
			UserToMediaReason.Finished,
			UserToMediaReason.Watchlist,
			UserToMediaReason.Owned,
		].includes(r),
	);

	const themeIconSurround = (idx: number, icon?: JSX.Element) => (
		<ThemeIcon variant="transparent" size="sm" color="cyan" key={idx}>
			{icon}
		</ThemeIcon>
	);

	return (
		<Flex
			key={`${props.bottomLeft}-${props.bottomRight}-${props.name}`}
			align="center"
			justify="center"
			direction="column"
		>
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
				<Box pos="absolute" style={{ zIndex: 999 }} top={10} left={10}>
					{props.topLeft}
				</Box>
				<Box pos="absolute" top={5} right={5}>
					{props.topRight}
				</Box>
				{reasons && reasons.length > 0 ? (
					<Group
						style={blackBgStyles}
						pos="absolute"
						bottom={5}
						left={5}
						gap={3}
					>
						{reasons
							.map((r) =>
								match(r)
									.with(UserToMediaReason.Finished, () => (
										<IconRosetteDiscountCheck />
									))
									.with(UserToMediaReason.Watchlist, () => <IconBookmarks />)
									.with(UserToMediaReason.Owned, () => <IconBackpack />)
									.run(),
							)
							.map((icon, idx) => themeIconSurround(idx, icon))}
					</Group>
				) : null}
			</SurroundingElement>
			<Flex w="100%" direction="column" px={{ base: 10, md: 3 }} py={4}>
				<Flex justify="space-between" direction="row" w="100%">
					<Text c="dimmed" size="sm">
						{props.bottomLeft}
					</Text>
					<Tooltip
						label={props.highlightRightText}
						disabled={!props.highlightRightText}
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
	mediaReason?: Array<UserToMediaReason> | null;
}) => {
	const navigate = useNavigate();
	const id = props.item.identifier;

	return (
		<BaseDisplayItem
			onClick={props.onClick}
			href={
				!props.noHref
					? props.href
						? props.href
						: match(props.entityLot)
								.with(EntityLot.Media, undefined, null, () =>
									$path("/media/item/:id", { id }),
								)
								.with(EntityLot.MediaGroup, () =>
									$path("/media/groups/item/:id", { id }),
								)
								.with(EntityLot.Person, () =>
									$path("/media/people/item/:id", { id }),
								)
								.with(EntityLot.Exercise, () =>
									$path("/fitness/exercises/item/:id", { id }),
								)
								.with(EntityLot.Collection, () =>
									$path("/collections/:id", { id }),
								)
								.exhaustive()
					: undefined
			}
			imageLink={props.item.image}
			imagePlaceholder={getInitials(props.item?.title || "")}
			topLeft={
				props.imageOverlayForLoadingIndicator ? (
					<Loader color="red" variant="bars" size="sm" />
				) : null
			}
			mediaReason={props.mediaReason}
			topRight={
				props.averageRating ? (
					<Box style={blackBgStyles}>
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
						style={blackBgStyles}
						onClick={(e) => {
							e.preventDefault();
							navigate(
								$path("/media/item/:id", { id }, { openReviewModal: true }),
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
		>
			{props.children}
		</BaseDisplayItem>
	);
};

export const DisplayCollection = (props: {
	userId: string;
	col: { id: string; name: string };
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
					<input readOnly hidden name="entityId" value={props.entityId} />
					<input readOnly hidden name="entityLot" value={props.entityLot} />
					<input readOnly hidden name="collectionName" value={props.col.name} />
					<input readOnly hidden name="creatorUserId" value={props.userId} />
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
	mangaVolumeNumber?: number | null;
	podcastEpisodeNumber?: number | null;
	existingReview?: DeepPartial<ReviewItem>;
};

type EntityType = "metadata" | "metadataGroup" | "collection" | "person";

export const PostReviewModal = (props: {
	opened: boolean;
	onClose: () => void;
	objectId: string;
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
						<Checkbox
							label="This review is a spoiler"
							mt="lg"
							name="isSpoiler"
						/>
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
						<>
							<Group wrap="nowrap">
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
								<Text ta="center" fw="bold" mt="sm">
									OR
								</Text>
								<NumberInput
									label="Volume"
									name="mangaVolumeNumber"
									hideControls
									defaultValue={
										props.data?.existingReview?.mangaExtraInformation?.volume
											? props.data.existingReview.mangaExtraInformation?.volume
											: props.data.mangaVolumeNumber || undefined
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

export const ToggleMediaMonitorMenuItem = (props: {
	userId: string;
	entityLot: EntityLot;
	inCollections: Array<string>;
	formValue: string;
}) => {
	const isMonitored = props.inCollections.includes("Monitoring");
	const action = isMonitored
		? "removeEntityFromCollection"
		: "addEntityToCollection";

	return (
		<Form action={`/actions?intent=${action}`} method="post" replace>
			<HiddenLocationInput />
			<input hidden name="collectionName" defaultValue="Monitoring" />
			<input readOnly hidden name="entityLot" value={props.entityLot} />
			<input readOnly hidden name="creatorUserId" value={props.userId} />
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
