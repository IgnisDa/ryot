import {
	ActionIcon,
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
	Text,
	TextInput,
	ThemeIcon,
	Tooltip,
} from "@mantine/core";
import { $path } from "remix-routes";
import "@mantine/dates/styles.css";
import { useDisclosure } from "@mantine/hooks";
import { Form, Link, useFetcher } from "@remix-run/react";
import {
	EntityLot,
	type MediaLot,
	MetadataGroupDetailsDocument,
	PersonDetailsDocument,
	type ReviewItem,
	SeenState,
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
import type { ReactNode } from "react";
import type { DeepPartial } from "ts-essentials";
import { match } from "ts-pattern";
import { withQuery, withoutHost } from "ufo";
import { MEDIA_DETAILS_HEIGHT } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import {
	clientGqlService,
	dayjsLib,
	getPartialMetadataDetailsQuery,
	queryFactory,
	redirectToQueryParam,
} from "~/lib/generals";
import {
	useConfirmSubmit,
	useFallbackImageUrl,
	useGetMantineColor,
	useUserDetails,
	useUserMetadataDetails,
	useUserPreferences,
} from "~/lib/hooks";
import {
	getExerciseDetailsQuery,
	getUserExerciseDetailsQuery,
	getWorkoutDetailsQuery,
} from "~/lib/state/fitness";
import { useMetadataProgressUpdate, useReviewEntity } from "~/lib/state/media";
import type { action } from "~/routes/actions";
import classes from "~/styles/common.module.css";

export const PartialMetadataDisplay = (props: {
	metadataId: string;
	extraText?: string;
}) => {
	const { data: metadataDetails } = useQuery(
		getPartialMetadataDetailsQuery(props.metadataId),
	);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);

	return (
		<Anchor
			component={Link}
			data-media-id={props.metadataId}
			to={$path("/media/item/:id", { id: props.metadataId })}
		>
			<Avatar
				imageProps={{ loading: "lazy" }}
				radius="sm"
				src={metadataDetails?.image}
				h={100}
				w={85}
				mx="auto"
				name={metadataDetails?.title}
				styles={{ image: { objectPosition: "top" } }}
			/>
			<Text
				mt={4}
				size="xs"
				ta="center"
				lineClamp={1}
				c={userMetadataDetails?.hasInteracted ? "yellow" : "dimmed"}
			>
				{metadataDetails?.title} {props.extraText}
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

const blackBgStyles = {
	backgroundColor: "rgba(0, 0, 0, 0.75)",
	borderRadius: 3,
	padding: 2,
} satisfies MantineStyleProp;

export const BaseMediaDisplayItem = (props: {
	isLoading: boolean;
	name?: string;
	altName?: string;
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
							{props.altName ?? props.name}
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
	name?: string;
	altName?: string;
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
		useQuery(getPartialMetadataDetailsQuery(props.metadataId));
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);
	const averageRating = userMetadataDetails?.averageRating;
	const history = (userMetadataDetails?.history || []).filter(
		(h) => h.state === SeenState.Completed,
	);
	const surroundReason = (
		idx: number,
		data: readonly [UserToMediaReason, ReactNode],
	) => (
		<Tooltip label={changeCase(data[0])} key={idx}>
			<ThemeIcon variant="transparent" size="sm" color="cyan">
				{data[1]}
			</ThemeIcon>
		</Tooltip>
	);
	const reasons = userMetadataDetails?.mediaReason?.filter((r) =>
		[
			UserToMediaReason.Finished,
			UserToMediaReason.Watchlist,
			UserToMediaReason.Owned,
		].includes(r),
	);
	const hasInteracted = userMetadataDetails?.hasInteracted;

	return (
		<BaseMediaDisplayItem
			name={props.name ?? metadataDetails?.title}
			altName={props.altName}
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
									<Text c={hasInteracted ? "yellow" : undefined}>
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
							{Number(averageRating) % 1 === 0
								? Math.round(Number(averageRating)).toString()
								: Number(averageRating).toFixed(1)}
							{userPreferences.general.reviewScale === UserReviewScale.OutOfFive
								? null
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
										.with(
											UserToMediaReason.Finished,
											() => [r, <IconRosetteDiscountCheck key={r} />] as const,
										)
										.with(
											UserToMediaReason.Watchlist,
											() => [r, <IconBookmarks key={r} />] as const,
										)
										.with(
											UserToMediaReason.Owned,
											() => [r, <IconBackpack key={r} />] as const,
										)
										.run(),
								)
								.map((data, idx) => surroundReason(idx, data))}
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
	rightLabel?: ReactNode;
	noLeftLabel?: boolean;
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
							left:
								props.noLeftLabel !== true
									? `${metadataDetails.details.parts} items`
									: undefined,
							right:
								props.rightLabel ||
								changeCase(snakeCase(metadataDetails.details.lot)),
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
	rightLabel?: ReactNode;
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
			labels={{
				left: personDetails
					? `${personDetails.contents.reduce((sum, content) => sum + content.items.length, 0)} items`
					: undefined,
				right: props.rightLabel,
			}}
			imageOverlay={{ topRight: props.topRight }}
		/>
	);
};

export const ExerciseDisplayItem = (props: {
	exerciseId: string;
	topRight?: ReactNode;
	rightLabel?: ReactNode;
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
			labels={{
				left: isNumber(times)
					? `${times} time${times > 1 ? "s" : ""}`
					: undefined,
				right: props.rightLabel,
			}}
			imageOverlay={{ topRight: props.topRight }}
		/>
	);
};

export const WorkoutDisplayItem = (props: {
	workoutId: string;
	rightLabel?: ReactNode;
	topRight?: ReactNode;
}) => {
	const { data: workoutDetails, isLoading: isWorkoutDetailsLoading } = useQuery(
		getWorkoutDetailsQuery(props.workoutId),
	);

	return (
		<BaseMediaDisplayItem
			name={workoutDetails?.details.name}
			isLoading={isWorkoutDetailsLoading}
			onImageClickBehavior={$path("/fitness/:entity/:id", {
				id: props.workoutId,
				entity: "workouts",
			})}
			labels={{
				left: dayjsLib(workoutDetails?.details.startTime).format("l"),
				right: props.rightLabel,
			}}
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
	const submit = useConfirmSubmit();

	return (
		<Form
			replace
			method="POST"
			action={withQuery("/actions", { intent: action })}
		>
			<input hidden name="collectionName" defaultValue="Monitoring" />
			<input readOnly hidden name="entityId" value={props.formValue} />
			<input readOnly hidden name="entityLot" value={props.entityLot} />
			<input readOnly hidden name="creatorUserId" value={userDetails.id} />
			<Menu.Item
				type="submit"
				color={isMonitored ? "red" : undefined}
				onClick={async (e) => {
					const form = e.currentTarget.form;
					if (form) {
						e.preventDefault();
						if (isMonitored) {
							const conf = await confirmWrapper({
								confirmation: "Are you sure you want to stop monitoring?",
							});
							if (conf) submit(form);
						} else {
							submit(form);
						}
					}
				}}
			>
				{isMonitored ? "Stop" : "Start"} monitoring
			</Menu.Item>
		</Form>
	);
};
