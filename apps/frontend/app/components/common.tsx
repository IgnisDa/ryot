import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Carousel } from "@mantine/carousel";
import {
	ActionIcon,
	Alert,
	Anchor,
	Avatar,
	Badge,
	Box,
	Button,
	Center,
	Checkbox,
	Collapse,
	Divider,
	Flex,
	Group,
	Image,
	Loader,
	type MantineStyleProp,
	Modal,
	MultiSelect,
	Paper,
	RingProgress,
	SimpleGrid,
	Skeleton,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
	rem,
	useMantineTheme,
} from "@mantine/core";
import { useDebouncedValue, useDidUpdate, useDisclosure } from "@mantine/hooks";
import {
	Form,
	Link,
	useFetcher,
	useNavigate,
	useRevalidator,
} from "@remix-run/react";
import {
	EntityLot,
	GridPacking,
	MediaLot,
	type MediaSource,
	type ReviewItem,
	type UserAnalytics,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	formatQuantityWithCompactNotation,
	getInitials,
	humanizeDuration,
	isNumber,
	isString,
	snakeCase,
} from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconBarbell,
	IconCheck,
	IconEdit,
	IconExternalLink,
	IconFilterOff,
	IconFriends,
	IconMoodEmpty,
	IconMoodHappy,
	IconMoodSad,
	IconRefresh,
	IconScaleOutline,
	IconSearch,
	IconServer,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Cookies from "js-cookie";
import type { ReactNode, Ref } from "react";
import { Fragment, useState } from "react";
import { $path } from "remix-routes";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import {
	MediaColors,
	PRO_REQUIRED_MESSAGE,
	ThreePointSmileyRating,
	convertDecimalToThreePointSmiley,
	dayjsLib,
	getMetadataIcon,
	getSurroundingElements,
	openConfirmationModal,
	reviewYellow,
} from "~/lib/generals";
import {
	useAppSearchParam,
	useConfirmSubmit,
	useCoreDetails,
	useFallbackImageUrl,
	useGetMantineColors,
	useGetRandomMantineColor,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/hooks";
import { useReviewEntity } from "~/lib/state/media";
import type { action } from "~/routes/actions";
import classes from "~/styles/common.module.css";
import {
	ExerciseDisplayItem,
	WorkoutDisplayItem,
	WorkoutTemplateDisplayItem,
	displayWeightWithUnit,
} from "./fitness";
import {
	MetadataDisplayItem,
	MetadataGroupDisplayItem,
	PersonDisplayItem,
} from "./media";

export const ApplicationGrid = (props: {
	children: ReactNode | Array<ReactNode>;
}) => {
	const userPreferences = useUserPreferences();
	const [parent] = useAutoAnimate();

	return (
		<SimpleGrid
			spacing="lg"
			ref={parent}
			cols={match(userPreferences.general.gridPacking)
				.with(GridPacking.Normal, () => ({ base: 2, sm: 3, md: 4, lg: 5 }))
				.with(GridPacking.Dense, () => ({ base: 3, sm: 4, md: 5, lg: 6 }))
				.exhaustive()}
		>
			{props.children}
		</SimpleGrid>
	);
};

export const MediaDetailsLayout = (props: {
	title: string;
	images: Array<string | null | undefined>;
	children: Array<ReactNode | (ReactNode | undefined)>;
	externalLink?: {
		lot?: MediaLot;
		source: MediaSource;
		href?: string | null;
	};
	partialDetailsFetcher: {
		entityId: string;
		isAlreadyPartial?: boolean | null;
		fn: () => Promise<boolean | undefined | null>;
	};
}) => {
	const [activeImageId, setActiveImageId] = useState(0);
	const fallbackImageUrl = useFallbackImageUrl();
	const revalidator = useRevalidator();

	const { data: isPartialData } = useQuery({
		queryFn: props.partialDetailsFetcher.fn,
		enabled: Boolean(props.partialDetailsFetcher.isAlreadyPartial),
		queryKey: ["pollDetails", props.partialDetailsFetcher.entityId],
		refetchInterval: (query) => {
			if (query.state.data === true) return 500;
			return false;
		},
	});

	return (
		<Flex direction={{ base: "column", md: "row" }} gap="lg">
			<Box
				pos="relative"
				id="images-container"
				className={classes.imagesContainer}
			>
				{props.images.length > 1 ? (
					<Carousel w={300} onSlideChange={setActiveImageId}>
						{props.images.map((url, idx) => (
							<Carousel.Slide key={url} data-image-idx={idx}>
								{getSurroundingElements(props.images, activeImageId).includes(
									idx,
								) ? (
									<Image src={url} radius="lg" />
								) : null}
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<Box w={300}>
						<Image
							radius="lg"
							height={400}
							src={props.images[0]}
							fallbackSrc={fallbackImageUrl}
						/>
					</Box>
				)}
				{props.externalLink ? (
					<Badge
						size="lg"
						top={10}
						left={10}
						color="dark"
						pos="absolute"
						id="data-source"
						variant="filled"
					>
						<Flex gap={4} align="center">
							<Text size="10">
								{snakeCase(props.externalLink.source)}
								{props.externalLink.lot
									? `:${snakeCase(props.externalLink.lot)}`
									: null}
							</Text>
							{props.externalLink.href ? (
								<Anchor href={props.externalLink.href} target="_blank" mt={2}>
									<IconExternalLink size={12.8} />
								</Anchor>
							) : null}
						</Flex>
					</Badge>
				) : null}
			</Box>
			<Stack id="details-container" style={{ flexGrow: 1 }}>
				<Group wrap="nowrap">
					{props.partialDetailsFetcher.isAlreadyPartial ? (
						isPartialData ? (
							<Loader size="sm" />
						) : (
							<ActionIcon size="sm" onClick={() => revalidator.revalidate()}>
								<IconRefresh />
							</ActionIcon>
						)
					) : null}
					<Title id="media-title">{props.title}</Title>
				</Group>
				{props.children}
			</Stack>
		</Flex>
	);
};

export const MEDIA_DETAILS_HEIGHT = { base: "45vh", "2xl": "55vh" };

export const DebouncedSearchInput = (props: {
	initialValue?: string;
	queryParam?: string;
	placeholder?: string;
	enhancedQueryParams?: string;
}) => {
	const [query, setQuery] = useState(props.initialValue || "");
	const [debounced] = useDebouncedValue(query, 1000);
	const [_e, { setP }] = useAppSearchParam(
		props.enhancedQueryParams || "query",
	);

	useDidUpdate(() => {
		setP(props.queryParam || "query", debounced);
	}, [debounced]);

	return (
		<TextInput
			name="query"
			placeholder={props.placeholder || "Search..."}
			leftSection={<IconSearch />}
			onChange={(e) => setQuery(e.currentTarget.value)}
			value={query}
			style={{ flexGrow: 1 }}
			autoCapitalize="none"
			autoComplete="off"
			rightSection={
				query ? (
					<ActionIcon onClick={() => setQuery("")}>
						<IconX size={16} />
					</ActionIcon>
				) : null
			}
		/>
	);
};

export const ProRequiredAlert = (props: {
	alertText?: string;
	tooltipLabel?: string;
}) => {
	const coreDetails = useCoreDetails();

	return !coreDetails.isServerKeyValidated ? (
		<Alert>
			<Tooltip label={props.tooltipLabel} disabled={!props.tooltipLabel}>
				<Text size="xs">{props.alertText || PRO_REQUIRED_MESSAGE}</Text>
			</Tooltip>
		</Alert>
	) : null;
};

const blackBgStyles = {
	backgroundColor: "rgba(0, 0, 0, 0.75)",
	borderRadius: 3,
	padding: 2,
} satisfies MantineStyleProp;

export const BaseMediaDisplayItem = (props: {
	name?: string;
	altName?: string;
	progress?: string;
	isLoading: boolean;
	nameRight?: ReactNode;
	imageUrl?: string | null;
	highlightImage?: boolean;
	innerRef?: Ref<HTMLDivElement>;
	labels?: { right?: ReactNode; left?: ReactNode };
	onImageClickBehavior: string | (() => Promise<void>);
	imageOverlay?: {
		topRight?: ReactNode;
		topLeft?: ReactNode;
		bottomRight?: ReactNode;
		bottomLeft?: ReactNode;
	};
}) => {
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const gridPacking = userPreferences.general.gridPacking;
	const SurroundingElement = (iProps: { children: ReactNode }) =>
		isString(props.onImageClickBehavior) ? (
			<Anchor component={Link} to={props.onImageClickBehavior}>
				{iProps.children}
			</Anchor>
		) : (
			<Box onClick={props.onImageClickBehavior}>{iProps.children}</Box>
		);
	const defaultOverlayProps = {
		pos: "absolute",
		style: { zIndex: 10, ...blackBgStyles },
	} as const;

	return (
		<Flex justify="space-between" direction="column" ref={props.innerRef}>
			<Box pos="relative" w="100%">
				<SurroundingElement>
					<Tooltip
						position="top"
						label={props.name}
						disabled={(props.name?.length || 0) === 0}
					>
						<Paper
							radius="md"
							pos="relative"
							style={{ overflow: "hidden" }}
							className={clsx({
								[classes.highlightImage]:
									coreDetails.isServerKeyValidated && props.highlightImage,
							})}
						>
							<Image
								src={props.imageUrl}
								alt={`Image for ${props.name}`}
								style={{
									cursor: "pointer",
									...match(gridPacking)
										.with(GridPacking.Normal, () => ({ height: 260 }))
										.with(GridPacking.Dense, () => ({ height: 180 }))
										.exhaustive(),
								}}
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
							{props.progress ? (
								<Paper
									h={5}
									bg="red"
									left={0}
									bottom={0}
									pos="absolute"
									w={`${props.progress}%`}
								/>
							) : null}
						</Paper>
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
					<Center
						left={5}
						bottom={props.progress ? 8 : 5}
						{...defaultOverlayProps}
					>
						{props.imageOverlay.bottomLeft}
					</Center>
				) : null}
				{props.imageOverlay?.bottomRight ? (
					<Center
						right={5}
						bottom={props.progress ? 8 : 5}
						{...defaultOverlayProps}
					>
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
				<Flex
					mt={2}
					w="100%"
					direction="column"
					px={match(gridPacking)
						.with(GridPacking.Normal, () => ({ base: 6, md: 3 }))
						.with(GridPacking.Dense, () => ({ md: 2 }))
						.exhaustive()}
				>
					<Flex w="100%" direction="row" justify="space-between">
						<Text
							size="sm"
							c="dimmed"
							visibleFrom={gridPacking === GridPacking.Dense ? "md" : undefined}
						>
							{props.labels?.left}
						</Text>
						<Text c="dimmed" size="sm">
							{props.labels?.right}
						</Text>
					</Flex>
					<Flex mb="xs" align="center" justify="space-between">
						<Text w="100%" truncate fw="bold">
							{props.altName ?? props.name}
						</Text>
						{props.nameRight}
					</Flex>
				</Flex>
			)}
		</Flex>
	);
};

export const FiltersModal = (props: {
	title?: string;
	opened: boolean;
	cookieName: string;
	children: ReactNode;
	closeFiltersModal: () => void;
}) => {
	const navigate = useNavigate();

	return (
		<Modal
			centered
			opened={props.opened}
			withCloseButton={false}
			onClose={props.closeFiltersModal}
		>
			<Stack>
				<Group justify="space-between">
					<Title order={3}>{props.title || "Filters"}</Title>
					<ActionIcon
						onClick={() => {
							navigate(".");
							props.closeFiltersModal();
							Cookies.remove(props.cookieName);
						}}
					>
						<IconFilterOff size={24} />
					</ActionIcon>
				</Group>
				{props.children}
			</Stack>
		</Modal>
	);
};

export const CollectionsFilter = (props: {
	cookieName: string;
	collections?: string[];
	invertCollection?: boolean;
}) => {
	const collections = useUserCollections();
	const [_, { setP }] = useAppSearchParam(props.cookieName);

	return (
		<MultiSelect
			flex={1}
			clearable
			searchable
			rightSectionWidth={rem(100)}
			rightSectionPointerEvents="all"
			defaultValue={props.collections}
			placeholder="Select a collection"
			onChange={(v) => setP("collections", v.join(","))}
			data={[
				{
					group: "My collections",
					items: collections.map((c) => ({
						value: c.id.toString(),
						label: c.name,
					})),
				},
			]}
			rightSection={
				<Checkbox
					label="Invert"
					checked={props.invertCollection}
					onChange={(e) => setP("invertCollection", String(e.target.checked))}
				/>
			}
		/>
	);
};

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
												{reviewScale === UserReviewScale.OutOfFive
													? undefined
													: "%"}
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
				rightLabel={changeCase(snakeCase(props.entityLot))}
				noLeftLabel
			/>
		))
		.with(EntityLot.Person, () => (
			<PersonDisplayItem
				personId={props.entityId}
				topRight={props.topRight}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.Exercise, () => (
			<ExerciseDisplayItem
				exerciseId={props.entityId}
				topRight={props.topRight}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.Workout, () => (
			<WorkoutDisplayItem
				workoutId={props.entityId}
				topRight={props.topRight}
				rightLabel={changeCase(snakeCase(props.entityLot))}
			/>
		))
		.with(EntityLot.WorkoutTemplate, () => (
			<WorkoutTemplateDisplayItem
				workoutTemplateId={props.entityId}
				topRight={props.topRight}
			/>
		))
		.run();

export const DisplayCollection = (props: {
	entityId: string;
	entityLot: EntityLot;
	creatorUserId: string;
	col: { id: string; name: string };
}) => {
	const color = useGetRandomMantineColor(props.col.name);
	const submit = useConfirmSubmit();

	return (
		<Badge key={props.col.id} color={color}>
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
					<ActionIcon
						size={16}
						onClick={(e) => {
							const form = e.currentTarget.form;
							e.preventDefault();
							openConfirmationModal(
								"Are you sure you want to remove this media from this collection?",
								() => submit(form),
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

export const DisplaySummarySection = ({
	latestUserSummary,
}: {
	latestUserSummary: UserAnalytics["activities"]["items"][0];
}) => {
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const theme = useMantineTheme();

	return (
		<SimpleGrid
			cols={{ base: 1, sm: 2, md: 3 }}
			style={{ alignItems: "center" }}
			spacing="xs"
		>
			<DisplayStatForMediaType
				lot={MediaLot.Movie}
				data={[
					{
						label: "Movies",
						value: latestUserSummary.movieCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalMovieDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Music}
				data={[
					{
						label: "Songs",
						value: latestUserSummary.musicCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalMusicDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Show}
				data={[
					{
						label: "Show episodes",
						value: latestUserSummary.showCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalShowDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.VideoGame}
				data={[
					{
						label: "Video games",
						value: latestUserSummary.videoGameCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalVideoGameDuration,
						type: "duration",
						hideIfZero: true,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.VisualNovel}
				data={[
					{
						label: "Visual Novels",
						value: latestUserSummary.visualNovelCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalVisualNovelDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.AudioBook}
				data={[
					{
						label: "Audio books",
						value: latestUserSummary.audioBookCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalAudioBookDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Book}
				data={[
					{
						label: "Books",
						value: latestUserSummary.bookCount,
						type: "number",
					},
					{
						label: "Pages",
						value: latestUserSummary.totalBookPages,
						type: "number",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Podcast}
				data={[
					{
						label: "Podcasts",
						value: latestUserSummary.podcastCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalPodcastDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Manga}
				data={[
					{
						label: "Manga",
						value: latestUserSummary.mangaCount,
						type: "number",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Anime}
				data={[
					{
						label: "Anime",
						value: latestUserSummary.animeCount,
						type: "number",
					},
				]}
			/>
			{userPreferences.featuresEnabled.media.enabled ? (
				<>
					<ActualDisplayStat
						icon={<IconServer />}
						lot="Metadata stats"
						color={theme.colors.grape[8]}
						data={[
							{
								label: "Media",
								value: latestUserSummary.totalMetadataCount,
								type: "number",
							},
							{
								label: "Reviews",
								value: latestUserSummary.totalMetadataReviewCount,
								type: "number",
								hideIfZero: true,
							},
						]}
					/>
					{userPreferences.featuresEnabled.media.people ? (
						<UnstyledLink
							to={$path("/media/people/:action", {
								action: "list",
							})}
						>
							<ActualDisplayStat
								icon={<IconFriends />}
								lot="People stats"
								color={theme.colors.red[9]}
								data={[
									{
										label: "People Reviewed",
										value: latestUserSummary.totalPersonReviewCount,
										type: "number",
										hideIfZero: true,
									},
								]}
							/>
						</UnstyledLink>
					) : null}
				</>
			) : null}
			{userPreferences.featuresEnabled.fitness.enabled ? (
				<UnstyledLink
					to={$path("/fitness/:entity/list", {
						entity: "workouts",
					})}
				>
					<ActualDisplayStat
						icon={<IconBarbell stroke={1.3} />}
						lot="Workouts"
						color={theme.colors.teal[2]}
						data={[
							{
								label: "Workouts",
								value: latestUserSummary.workoutCount,
								type: "number",
							},
							{
								label: "Runtime",
								value: latestUserSummary.totalWorkoutDuration,
								type: "duration",
							},
							{
								label: "Runtime",
								value: displayWeightWithUnit(
									unitSystem,
									latestUserSummary.totalWorkoutWeight,
									true,
								),
								type: "string",
							},
						]}
					/>
				</UnstyledLink>
			) : null}
			{userPreferences.featuresEnabled.fitness.enabled ? (
				<ActualDisplayStat
					icon={<IconScaleOutline stroke={1.3} />}
					lot="Fitness"
					color={theme.colors.yellow[5]}
					data={[
						{
							label: "Measurements",
							value: latestUserSummary.userMeasurementCount,
							type: "number",
							hideIfZero: true,
						},
					]}
				/>
			) : null}
		</SimpleGrid>
	);
};

const ActualDisplayStat = (props: {
	icon: ReactNode;
	lot: string;
	data: Array<{
		type: "duration" | "number" | "string";
		label: string;
		value: number | string;
		hideIfZero?: true;
	}>;
	color?: string;
}) => {
	const colors = useGetMantineColors();

	return (
		<Flex align="center">
			<RingProgress
				size={60}
				thickness={4}
				sections={[]}
				label={<Center>{props.icon}</Center>}
				rootColor={props.color ?? colors[11]}
			/>
			<Flex wrap="wrap" ml="xs">
				{props.data.map((d, idx) => (
					<Fragment key={idx.toString()}>
						{isNumber(d.type) && d.value === 0 && d.hideIfZero ? undefined : (
							<Box mx="xs" data-stat-stringified={JSON.stringify(d)}>
								<Text
									fw={d.label !== "Runtime" ? "bold" : undefined}
									display="inline"
									fz={{ base: "md", md: "sm", xl: "md" }}
								>
									{match(d.type)
										.with("string", () => d.value)
										.with("duration", () =>
											humanizeDuration(
												dayjsLib
													.duration(Number(d.value), "minutes")
													.asMilliseconds(),
												{
													round: true,
													largest: 3,
												},
											),
										)
										.with("number", () =>
											formatQuantityWithCompactNotation(Number(d.value)),
										)
										.exhaustive()}
								</Text>
								<Text
									display="inline"
									ml="4px"
									fz={{ base: "md", md: "sm", xl: "md" }}
								>
									{d.label === "Runtime" ? "" : d.label}
								</Text>
							</Box>
						)}
					</Fragment>
				))}
			</Flex>
		</Flex>
	);
};

const DisplayStatForMediaType = (props: {
	lot: MediaLot;
	data: Array<{
		type: "duration" | "number";
		label: string;
		value: number;
		hideIfZero?: true;
	}>;
}) => {
	const userPreferences = useUserPreferences();
	const isEnabled = userPreferences.featuresEnabled.media.specific.includes(
		props.lot,
	);
	const Icon = getMetadataIcon(props.lot);
	const icon = <Icon size={24} stroke={1.5} />;

	return isEnabled && userPreferences.featuresEnabled.media.enabled ? (
		<UnstyledLink
			to={$path("/media/:action/:lot", {
				action: "list",
				lot: props.lot.toLowerCase(),
			})}
		>
			<ActualDisplayStat
				data={props.data}
				icon={icon}
				lot={props.lot.toString()}
				color={MediaColors[props.lot]}
			/>
		</UnstyledLink>
	) : null;
};

const UnstyledLink = (props: { children: ReactNode; to: string }) => {
	return (
		<Link to={props.to} style={{ all: "unset", cursor: "pointer" }}>
			{props.children}
		</Link>
	);
};
