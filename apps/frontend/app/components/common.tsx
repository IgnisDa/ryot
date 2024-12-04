import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
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
	type MantineStyleProp,
	Modal,
	MultiSelect,
	Paper,
	SimpleGrid,
	Skeleton,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
	rem,
} from "@mantine/core";
import { useDebouncedValue, useDidUpdate, useDisclosure } from "@mantine/hooks";
import { Form, Link, useFetcher, useNavigate } from "@remix-run/react";
import {
	EntityLot,
	GridPacking,
	type MediaLot,
	type MediaSource,
	type ReviewItem,
	UserReviewScale,
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
	IconCheck,
	IconEdit,
	IconExternalLink,
	IconFilterOff,
	IconMoodEmpty,
	IconMoodHappy,
	IconMoodSad,
	IconSearch,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import Cookies from "js-cookie";
import type { ReactNode, Ref } from "react";
import { useState } from "react";
import { $path } from "remix-routes";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import {
	PRO_REQUIRED_MESSAGE,
	ThreePointSmileyRating,
	convertDecimalToThreePointSmiley,
	dayjsLib,
	getSurroundingElements,
	reviewYellow,
} from "~/lib/generals";
import {
	useAppSearchParam,
	useConfirmSubmit,
	useCoreDetails,
	useFallbackImageUrl,
	useGetRandomMantineColor,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useReviewEntity } from "~/lib/state/media";
import type { action } from "~/routes/actions";
import classes from "~/styles/common.module.css";
import { confirmWrapper } from "./confirmation";
import {
	ExerciseDisplayItem,
	WorkoutDisplayItem,
	WorkoutTemplateDisplayItem,
} from "./fitness";
import {
	MetadataDisplayItem,
	MetadataGroupDisplayItem,
	PersonDisplayItem,
} from "./media";
import clsx from "clsx";

export const ApplicationGrid = (props: {
	children: ReactNode | Array<ReactNode>;
}) => {
	const userPreferences = useUserPreferences();

	return (
		<SimpleGrid
			cols={match(userPreferences.general.gridPacking)
				.with(GridPacking.Normal, () => ({ base: 2, sm: 3, md: 4, lg: 5 }))
				.with(GridPacking.Dense, () => ({ base: 3, sm: 4, md: 5, lg: 6 }))
				.exhaustive()}
			spacing="lg"
		>
			{props.children}
		</SimpleGrid>
	);
};

export const MediaDetailsLayout = (props: {
	images: Array<string | null | undefined>;
	children: Array<ReactNode | (ReactNode | undefined)>;
	externalLink?: {
		source: MediaSource;
		lot?: MediaLot;
		href?: string | null;
	};
}) => {
	const [activeImageId, setActiveImageId] = useState(0);
	const fallbackImageUrl = useFallbackImageUrl();

	return (
		<Flex direction={{ base: "column", md: "row" }} gap="lg">
			<Box
				id="images-container"
				pos="relative"
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
							src={props.images[0]}
							height={400}
							radius="lg"
							fallbackSrc={fallbackImageUrl}
						/>
					</Box>
				)}
				{props.externalLink ? (
					<Badge
						id="data-source"
						pos="absolute"
						size="lg"
						top={10}
						left={10}
						color="dark"
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

export const ProRequiredAlert = (props: { tooltipLabel?: string }) => {
	const coreDetails = useCoreDetails();

	return !coreDetails.isServerKeyValidated ? (
		<Alert>
			<Tooltip label={props.tooltipLabel} disabled={!props.tooltipLabel}>
				<Text size="xs">{PRO_REQUIRED_MESSAGE}</Text>
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
					<Tooltip label={props.name} position="top">
						<Paper
							radius="md"
							pos="relative"
							style={{ overflow: "hidden" }}
							className={clsx({
								[classes.highlightImage]: props.highlightImage,
							})}
						>
							<Image
								src={props.imageUrl}
								style={{
									cursor: "pointer",
									...match(gridPacking)
										.with(GridPacking.Normal, () => ({ height: 260 }))
										.with(GridPacking.Dense, () => ({ height: 180 }))
										.exhaustive(),
								}}
								alt={`Image for ${props.name}`}
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
					w="100%"
					direction="column"
					mt={2}
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
	opened: boolean;
	cookieName: string;
	children: ReactNode;
	closeFiltersModal: () => void;
	title?: string;
}) => {
	const navigate = useNavigate();

	return (
		<Modal
			onClose={props.closeFiltersModal}
			opened={props.opened}
			withCloseButton={false}
			centered
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
	rating?: string | null;
	size?: number;
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
									onClick={async () => {
										const conf = await confirmWrapper({
											confirmation:
												"Are you sure you want to delete this review? This action cannot be undone.",
										});
										if (conf)
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
																onClick={async (e) => {
																	const form = e.currentTarget.form;
																	e.preventDefault();
																	const conf = await confirmWrapper({
																		confirmation:
																			"Are you sure you want to delete this comment?",
																	});
																	if (conf && form) submit(form);
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
	creatorUserId: string;
	col: { id: string; name: string };
	entityId: string;
	entityLot: EntityLot;
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
						onClick={async (e) => {
							const form = e.currentTarget.form;
							e.preventDefault();
							const conf = await confirmWrapper({
								confirmation:
									"Are you sure you want to remove this media from this collection?",
							});
							if (conf && form) submit(form);
						}}
					>
						<IconX />
					</ActionIcon>
				</Flex>
			</Form>
		</Badge>
	);
};
