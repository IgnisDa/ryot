import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Alert,
	Anchor,
	Avatar,
	Badge,
	Box,
	Button,
	Center,
	Collapse,
	Divider,
	Flex,
	Group,
	Image,
	Loader,
	type MantineStyleProp,
	Menu,
	Paper,
	ScrollArea,
	Skeleton,
	Stack,
	type StyleProp,
	Text,
	TextInput,
	ThemeIcon,
	Tooltip,
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
	type MediaLot,
	type MediaSource,
	MetadataGroupDetailsDocument,
	MetadataPartialDetailsDocument,
	type PartialMetadata,
	PersonDetailsDocument,
	type ReviewItem,
	UserReviewScale,
	UserToMediaReason,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	getInitials,
	isNumber,
	isString,
	snakeCase,
} from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconArrowsRight,
	IconBackpack,
	IconBookmarks,
	IconCheck,
	IconCloudDownload,
	IconEdit,
	IconPlayerPlay,
	IconRosetteDiscountCheck,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { withQuery, withoutHost } from "ufo";
import { HiddenLocationInput, MEDIA_DETAILS_HEIGHT } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import {
	clientGqlService,
	dayjsLib,
	queryFactory,
	redirectToQueryParam,
} from "~/lib/generals";
import {
	useFallbackImageUrl,
	useGetMantineColor,
	useUserDetails,
	useUserMetadataDetails,
	useUserPreferences,
} from "~/lib/hooks";
import {
	getExerciseDetailsQuery,
	getUserExerciseDetailsQuery,
} from "~/lib/state/fitness";
import { useMetadataProgressUpdate, useReviewEntity } from "~/lib/state/media";
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
		<ScrollArea.Autosize mah={MEDIA_DETAILS_HEIGHT}>
			{props.children}
		</ScrollArea.Autosize>
	);
};

export const ReviewItemDisplay = (props: {
	review: DeepPartial<ReviewItem>;
	entityLot: EntityLot;
	title: string;
	entityId: string;
	lot?: MediaLot;
}) => {
	const userDetails = useUserDetails();
	const userPreferences = useUserPreferences();
	const reviewScale = userPreferences.general.reviewScale;
	const [opened, { toggle }] = useDisclosure(false);
	const [openedLeaveComment, { toggle: toggleLeaveComment }] =
		useDisclosure(false);
	const deleteReviewFetcher = useFetcher<typeof action>();
	const [_, setEntityToReview] = useReviewEntity();

	const submit = useSubmit();

	return (
		<>
			<Box key={props.review.id} data-review-id={props.review.id}>
				<Flex align="center" gap="sm">
					<Avatar color="cyan" radius="xl">
						{getInitials(props.review.postedBy?.name || "")}{" "}
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
								onClick={async () => {
									const conf = await confirmWrapper({
										confirmation:
											"Are you sure you want to delete this review? This action cannot be undone.",
									});
									if (conf)
										deleteReviewFetcher.submit(
											{
												[redirectToQueryParam]: withoutHost(location.href),
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
								}}
								color="red"
							>
								<IconTrash size={16} />
							</ActionIcon>
						</>
					) : null}
				</Flex>
				<Box ml="sm" mt="xs">
					{isNumber(props.review.showExtraInformation?.season) ? (
						<Text c="dimmed">
							S{props.review.showExtraInformation.season}-E
							{props.review.showExtraInformation.episode}
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
					{(Number(props.review.rating) || 0) > 0 ? (
						<Flex align="center" gap={4}>
							<IconStarFilled size={16} style={{ color: "#EBE600FF" }} />
							<Text className={classes.text} fw="bold">
								{props.review.rating}
								{reviewScale === UserReviewScale.OutOfFive ? undefined : "%"}
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
							method="POST"
							onSubmit={() => toggleLeaveComment()}
							action={withQuery("/actions", { intent: "createReviewComment" })}
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
														method="POST"
														action={withQuery("/actions", {
															intent: "createReviewComment",
														})}
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
	imageUrl?: string | null;
	topRight?: ReactNode;
	topLeft?: ReactNode;
	bottomLeft?: string | number | null;
	bottomRight?: string | number | null;
	href?: string;
	highlightRightText?: string;
	children?: ReactNode;
	nameRight?: ReactNode;
	mediaReason?: Array<UserToMediaReason> | null;
}) => {
	const fallbackImageUrl = useFallbackImageUrl(getInitials(props.name));

	const SurroundingElement = (iProps: {
		children: ReactNode;
		style: CSSProperties;
		pos: StyleProp<CSSProperties["position"]>;
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

	const themeIconSurround = (idx: number, icon?: ReactNode) => (
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
					src={props.imageUrl}
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
					fallbackSrc={fallbackImageUrl}
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

export const BaseMediaDisplayItem = (props: {
	isLoading: boolean;
	name?: string;
	imageUrl?: string | null;
	imageOverlay?: {
		topRight?: ReactNode;
		topLeft?: ReactNode;
		bottomRight?: ReactNode;
		bottomLeft?: ReactNode;
	};
	labels?: { right?: ReactNode; left?: ReactNode };
	onImageClickBehavior: string | (() => Promise<void>);
	nameRight?: ReactNode;
}) => {
	const SurroundingElement = (iProps: { children: ReactNode }) =>
		isString(props.onImageClickBehavior) ? (
			<Anchor component={Link} to={props.onImageClickBehavior}>
				{iProps.children}
			</Anchor>
		) : (
			<Box onClick={props.onImageClickBehavior}>{iProps.children}</Box>
		);
	const defaultOverlayProps = {
		style: { zIndex: 10, ...blackBgStyles },
		pos: "absolute",
	} as const;

	return (
		<Flex justify="space-between" direction="column">
			<Box pos="relative" w="100%">
				<SurroundingElement>
					<Tooltip label={props.name} position="top">
						<Image
							src={props.imageUrl}
							radius="md"
							style={{ cursor: "pointer", height: 260, w: 170 }}
							alt={`Image for ${props.name}`}
							className={classes.mediaImage}
							styles={{
								root: {
									transitionProperty: "transform",
									transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
									transitionDuration: "150ms",
								},
							}}
							fallbackSrc={useFallbackImageUrl(
								props.isLoading
									? "Loading..."
									: props.name
										? getInitials(props.name)
										: undefined,
							)}
						/>
					</Tooltip>
				</SurroundingElement>
				{props.imageOverlay?.topLeft ? (
					<Center top={5} left={5} {...defaultOverlayProps}>
						{props.imageOverlay.topLeft}
					</Center>
				) : null}
				{props.imageOverlay?.topRight ? (
					<Center top={5} right={5} {...defaultOverlayProps}>
						{props.imageOverlay.topRight}
					</Center>
				) : null}
				{props.imageOverlay?.bottomLeft ? (
					<Center bottom={5} left={5} {...defaultOverlayProps}>
						{props.imageOverlay.bottomLeft}
					</Center>
				) : null}
				{props.imageOverlay?.bottomRight ? (
					<Center bottom={5} right={5} {...defaultOverlayProps}>
						{props.imageOverlay.bottomRight}
					</Center>
				) : null}
			</Box>
			{props.isLoading ? (
				<>
					<Skeleton height={22} mt={10} />
					<Skeleton height={22} mt={8} />
				</>
			) : (
				<Flex w="100%" direction="column" px={{ base: 10, md: 3 }} pt={4}>
					<Flex justify="space-between" direction="row" w="100%">
						<Text c="dimmed" size="sm">
							{props.labels?.left}
						</Text>
						<Text c="dimmed" size="sm">
							{props.labels?.right}
						</Text>
					</Flex>
					<Flex justify="space-between" align="center" mb="xs">
						<Text w="100%" truncate fw="bold">
							{props.name}
						</Text>
						{props.nameRight}
					</Flex>
				</Flex>
			)}
		</Flex>
	);
};

export const MetadataDisplayItem = (props: {
	metadataId: string;
	topRight?: ReactNode;
	rightLabel?: ReactNode;
	rightLabelHistory?: boolean;
	rightLabelLot?: boolean;
	noLeftLabel?: boolean;
}) => {
	const [_r, setEntityToReview] = useReviewEntity();
	const [_, setMetadataToUpdate, isMetadataToUpdateLoading] =
		useMetadataProgressUpdate();
	const userPreferences = useUserPreferences();
	const { data: metadataDetails, isLoading: isMetadataDetailsLoading } =
		useQuery({
			queryKey: queryFactory.media.metadataPartialDetails(props.metadataId)
				.queryKey,
			queryFn: async () => {
				return clientGqlService
					.request(MetadataPartialDetailsDocument, props)
					.then((data) => data.metadataPartialDetails);
			},
		});
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);
	const averageRating = userMetadataDetails?.averageRating;
	const history = userMetadataDetails?.history || [];
	const themeIconSurround = (idx: number, icon?: ReactNode) => (
		<ThemeIcon variant="transparent" size="sm" color="cyan" key={idx}>
			{icon}
		</ThemeIcon>
	);
	const reasons = userMetadataDetails?.mediaReason?.filter((r) =>
		[
			UserToMediaReason.Finished,
			UserToMediaReason.Watchlist,
			UserToMediaReason.Owned,
		].includes(r),
	);

	return (
		<BaseMediaDisplayItem
			name={metadataDetails?.title}
			isLoading={isMetadataDetailsLoading}
			onImageClickBehavior={$path("/media/item/:id", { id: props.metadataId })}
			imageUrl={metadataDetails?.image}
			labels={
				metadataDetails
					? {
							left:
								props.noLeftLabel !== true
									? metadataDetails.publishYear
									: undefined,
							right:
								props.rightLabel ||
								(props.rightLabelLot
									? changeCase(snakeCase(metadataDetails.lot))
									: undefined) ||
								(props.rightLabelHistory ? (
									history.length > 0 ? (
										`${history.length} time${history.length === 1 ? "" : "s"}`
									) : null
								) : (
									<Text c={history.length > 0 ? "yellow" : undefined}>
										{changeCase(snakeCase(metadataDetails.lot))}
									</Text>
								)),
						}
					: undefined
			}
			imageOverlay={{
				topRight: props.topRight ? (
					props.topRight
				) : averageRating ? (
					<Group gap={4}>
						<IconStarFilled size={12} style={{ color: "#EBE600FF" }} />
						<Text c="white" size="xs" fw="bold" pr={4}>
							{match(userPreferences.general.reviewScale)
								.with(UserReviewScale.OutOfFive, () =>
									Number.parseFloat(averageRating.toString()).toFixed(1),
								)
								.with(UserReviewScale.OutOfHundred, () => averageRating)
								.exhaustive()}
							{userPreferences.general.reviewScale === UserReviewScale.OutOfFive
								? undefined
								: " %"}
						</Text>
					</Group>
				) : (
					<IconStarFilled
						cursor="pointer"
						onClick={() => {
							if (metadataDetails)
								setEntityToReview({
									entityId: props.metadataId,
									entityLot: EntityLot.Metadata,
									metadataLot: metadataDetails.lot,
									entityTitle: metadataDetails.title,
								});
						}}
						size={16}
						className={classes.starIcon}
					/>
				),
				bottomLeft:
					reasons && reasons.length > 0 ? (
						<Group gap={3}>
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
					) : null,
				bottomRight: isMetadataToUpdateLoading ? (
					<Loader color="red" size="xs" m={2} />
				) : (
					<ActionIcon
						variant="transparent"
						color="blue"
						size="compact-md"
						onClick={() =>
							setMetadataToUpdate({ metadataId: props.metadataId }, true)
						}
					>
						<IconPlayerPlay size={20} />
					</ActionIcon>
				),
			}}
		/>
	);
};

export const MetadataGroupDisplayItem = (props: {
	metadataGroupId: string;
	topRight?: ReactNode;
}) => {
	const { data: metadataDetails, isLoading: isMetadataDetailsLoading } =
		useQuery({
			queryKey: queryFactory.media.metadataGroupDetails(props.metadataGroupId)
				.queryKey,
			queryFn: async () => {
				return clientGqlService
					.request(MetadataGroupDetailsDocument, props)
					.then((data) => data.metadataGroupDetails);
			},
		});

	return (
		<BaseMediaDisplayItem
			name={metadataDetails?.details.title}
			isLoading={isMetadataDetailsLoading}
			onImageClickBehavior={$path("/media/groups/item/:id", {
				id: props.metadataGroupId,
			})}
			imageUrl={metadataDetails?.details.displayImages.at(0)}
			labels={
				metadataDetails
					? {
							left: `${metadataDetails.details.parts} items`,
							right: changeCase(snakeCase(metadataDetails.details.lot)),
						}
					: undefined
			}
			imageOverlay={{ topRight: props.topRight }}
		/>
	);
};

export const PersonDisplayItem = (props: {
	personId: string;
	topRight?: ReactNode;
}) => {
	const { data: personDetails, isLoading: isPersonDetailsLoading } = useQuery({
		queryKey: queryFactory.media.personDetails(props.personId).queryKey,
		queryFn: async () => {
			return clientGqlService
				.request(PersonDetailsDocument, props)
				.then((data) => data.personDetails);
		},
	});

	return (
		<BaseMediaDisplayItem
			name={personDetails?.details.name}
			isLoading={isPersonDetailsLoading}
			onImageClickBehavior={$path("/media/people/item/:id", {
				id: props.personId,
			})}
			imageUrl={personDetails?.details.displayImages.at(0)}
			labels={
				personDetails
					? { left: `${personDetails.contents.length} items` }
					: undefined
			}
			imageOverlay={{ topRight: props.topRight }}
		/>
	);
};

export const ExerciseDisplayItem = (props: {
	exerciseId: string;
	topRight?: ReactNode;
}) => {
	const { data: exerciseDetails, isLoading: isExerciseDetailsLoading } =
		useQuery(getExerciseDetailsQuery(props.exerciseId));
	const { data: userExerciseDetails } = useQuery(
		getUserExerciseDetailsQuery(props.exerciseId),
	);
	const times = userExerciseDetails?.details?.exerciseNumTimesInteracted;

	return (
		<BaseMediaDisplayItem
			name={exerciseDetails?.id}
			isLoading={isExerciseDetailsLoading}
			onImageClickBehavior={$path("/fitness/exercises/item/:id", {
				id: props.exerciseId,
			})}
			imageUrl={exerciseDetails?.attributes.images.at(0)}
			labels={
				isNumber(times)
					? { left: `${times} time${times > 1 ? "s" : ""}` }
					: undefined
			}
			imageOverlay={{ topRight: props.topRight }}
		/>
	);
};

export const DisplayCollectionEntity = (props: {
	entityId: string;
	entityLot: EntityLot;
	topRight?: ReactNode;
}) =>
	match(props.entityLot)
		.with(EntityLot.Metadata, () => (
			<MetadataDisplayItem
				metadataId={props.entityId}
				topRight={props.topRight}
				rightLabelLot
			/>
		))
		.with(EntityLot.MetadataGroup, () => (
			<MetadataGroupDisplayItem
				metadataGroupId={props.entityId}
				topRight={props.topRight}
			/>
		))
		.with(EntityLot.Person, () => (
			<PersonDisplayItem personId={props.entityId} topRight={props.topRight} />
		))
		.with(EntityLot.Exercise, () => (
			<ExerciseDisplayItem
				exerciseId={props.entityId}
				topRight={props.topRight}
			/>
		))
		.run();

export const DisplayCollection = (props: {
	creatorUserId: string;
	col: { id: string; name: string };
	entityId: string;
	entityLot: EntityLot;
}) => {
	const getMantineColor = useGetMantineColor();
	const submit = useSubmit();

	return (
		<Badge key={props.col.id} color={getMantineColor(props.col.name)}>
			<Form
				method="POST"
				action={withQuery("/actions", { intent: "removeEntityFromCollection" })}
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
					<input readOnly hidden name="entityId" value={props.entityId} />
					<input readOnly hidden name="entityLot" value={props.entityLot} />
					<input readOnly hidden name="collectionName" value={props.col.name} />
					<input
						readOnly
						hidden
						name="creatorUserId"
						value={props.creatorUserId}
					/>
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
	entityLot: EntityLot;
	inCollections: Array<string>;
	formValue: string;
}) => {
	const isMonitored = props.inCollections.includes("Monitoring");
	const action = isMonitored
		? "removeEntityFromCollection"
		: "addEntityToCollection";
	const userDetails = useUserDetails();

	return (
		<Form
			replace
			method="POST"
			action={withQuery("/actions", { intent: action })}
		>
			<HiddenLocationInput />
			<input hidden name="collectionName" defaultValue="Monitoring" />
			<input readOnly hidden name="entityLot" value={props.entityLot} />
			<input readOnly hidden name="creatorUserId" value={userDetails.id} />
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
