import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Alert,
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
	Modal,
	MultiSelect,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useDebouncedValue, useDidUpdate, useDisclosure } from "@mantine/hooks";
import { Form, Link, useFetcher, useNavigate } from "@remix-run/react";
import {
	CommitMetadataGroupDocument,
	DeployUpdateMetadataJobDocument,
	DeployUpdatePersonJobDocument,
	EntityLot,
	type MediaLot,
	type MediaSource,
	MetadataDetailsDocument,
	MetadataGroupDetailsDocument,
	PersonDetailsDocument,
	type ReviewItem,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, isNumber, snakeCase } from "@ryot/ts-utils";
import {
	IconArrowBigUp,
	IconCheck,
	IconCloudDownload,
	IconEdit,
	IconExternalLink,
	IconFilterOff,
	IconMoodEmpty,
	IconMoodHappy,
	IconMoodSad,
	IconRotateClockwise2,
	IconSearch,
	IconStarFilled,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Cookies from "js-cookie";
import type { ReactNode } from "react";
import { useState } from "react";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import {
	ThreePointSmileyRating,
	clientGqlService,
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
	useGetMantineColor,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useReviewEntity } from "~/lib/state/media";
import type { action } from "~/routes/actions";
import classes from "~/styles/common.module.css";
import { confirmWrapper } from "./confirmation";
import { ExerciseDisplayItem, WorkoutDisplayItem } from "./fitness";
import {
	MetadataDisplayItem,
	MetadataGroupDisplayItem,
	PersonDisplayItem,
} from "./media";

export const ApplicationGrid = (props: {
	children: ReactNode | Array<ReactNode>;
}) => {
	return (
		<SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="lg">
			{props.children}
		</SimpleGrid>
	);
};

export const MediaDetailsLayout = (props: {
	children: Array<ReactNode | (ReactNode | undefined)>;
	images: Array<string | null | undefined>;
	entityDetails: { id: string; lot: EntityLot; isPartial?: boolean | null };
	externalLink?: {
		source: MediaSource;
		lot?: MediaLot;
		href?: string | null;
	};
}) => {
	const queryKey = match(props.entityDetails.lot)
		.with(EntityLot.Metadata, () => ["metadata", props.entityDetails.id])
		.with(EntityLot.Person, () => ["person", props.entityDetails.id])
		.with(EntityLot.MetadataGroup, () => [
			"metadataGroup",
			props.entityDetails.id,
		])
		.run();
	const [activeImageId, setActiveImageId] = useState(0);
	const fallbackImageUrl = useFallbackImageUrl();
	const [mutationHasRunOnce, setMutationHasRunOnce] = useState(false);
	const [parent] = useAutoAnimate();
	const entityDetails = useQuery({
		queryKey,
		queryFn: async () => {
			const [identifier, lot, source, isPartial] = await match(
				props.entityDetails.lot,
			)
				.with(EntityLot.Metadata, () =>
					clientGqlService
						.request(MetadataDetailsDocument, {
							metadataId: props.entityDetails.id,
						})
						.then(
							(data) =>
								[
									data.metadataDetails.id,
									undefined,
									undefined,
									data.metadataDetails.isPartial,
								] as const,
						),
				)
				.with(EntityLot.Person, () =>
					clientGqlService
						.request(PersonDetailsDocument, {
							personId: props.entityDetails.id,
						})
						.then(
							(data) =>
								[
									data.personDetails.details.id,
									undefined,
									data.personDetails.details.source,
									data.personDetails.details.isPartial,
								] as const,
						),
				)
				.with(EntityLot.MetadataGroup, () =>
					clientGqlService
						.request(MetadataGroupDetailsDocument, {
							metadataGroupId: props.entityDetails.id,
						})
						.then(
							(data) =>
								[
									data.metadataGroupDetails.details.identifier,
									data.metadataGroupDetails.details.lot,
									data.metadataGroupDetails.details.source,
									data.metadataGroupDetails.details.isPartial,
								] as const,
						),
				)
				.run();
			return { identifier, lot, source, isPartial };
		},
		refetchInterval: dayjsLib.duration(1, "second").asMilliseconds(),
		enabled: props.entityDetails.isPartial === true,
	});
	const commitEntity = useMutation({
		mutationFn: async () => {
			match(props.entityDetails.lot)
				.with(EntityLot.Metadata, () =>
					clientGqlService.request(DeployUpdateMetadataJobDocument, {
						metadataId: entityDetails.data?.identifier || "",
					}),
				)
				.with(EntityLot.MetadataGroup, () => {
					invariant(entityDetails.data?.lot && entityDetails.data?.source);
					return clientGqlService
						.request(CommitMetadataGroupDocument, {
							input: {
								lot: entityDetails.data.lot,
								source: entityDetails.data.source,
								identifier: entityDetails.data.identifier,
							},
						})
						.then((data) => data.commitMetadataGroup);
				})
				.with(EntityLot.Person, () =>
					clientGqlService.request(DeployUpdatePersonJobDocument, {
						personId: entityDetails.data?.identifier || "",
					}),
				)
				.run();
		},
		onSuccess: () => setMutationHasRunOnce(true),
	});

	useDidUpdate(() => {
		if (entityDetails.data?.isPartial && !mutationHasRunOnce)
			commitEntity.mutate();
	}, [entityDetails]);

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
				<Box mt="md" ref={parent} id="partial-entity-indicator">
					{entityDetails.data?.isPartial ? (
						<Flex align="center" gap={4}>
							<IconCloudDownload size={20} />
							<Text size="xs">
								Details of this{" "}
								{changeCase(props.entityDetails.lot).toLowerCase()} are being
								downloaded
							</Text>
						</Flex>
					) : null}
					{[false, null, undefined].includes(entityDetails.data?.isPartial) &&
					mutationHasRunOnce ? (
						<Flex align="center" gap={4}>
							<IconRotateClockwise2 size={20} />
							<Text size="xs">Details updated, please refresh the page.</Text>
						</Flex>
					) : undefined}
				</Box>
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

	return !coreDetails.isPro ? (
		<Alert>
			<Tooltip label={props.tooltipLabel} disabled={!props.tooltipLabel}>
				<Text size="xs">
					<Anchor href={coreDetails.websiteUrl} target="_blank">
						Ryot Pro
					</Anchor>{" "}
					required to use this feature
				</Text>
			</Tooltip>
		</Alert>
	) : null;
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
}) => {
	const collections = useUserCollections();
	const [_, { setP }] = useAppSearchParam(props.cookieName);

	return (
		<MultiSelect
			placeholder="Select a collection"
			defaultValue={props.collections}
			data={[
				{
					group: "My collections",
					items: collections.map((c) => ({
						value: c.id.toString(),
						label: c.name,
					})),
				},
			]}
			onChange={(v) => setP("collections", v.join(","))}
			clearable
			searchable
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
	review: DeepPartial<ReviewItem>;
	entityLot: EntityLot;
	title: string;
	entityId: string;
	lot?: MediaLot;
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
			<Divider />
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
		.run();

export const DisplayCollection = (props: {
	creatorUserId: string;
	col: { id: string; name: string };
	entityId: string;
	entityLot: EntityLot;
}) => {
	const getMantineColor = useGetMantineColor();
	const submit = useConfirmSubmit();

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
