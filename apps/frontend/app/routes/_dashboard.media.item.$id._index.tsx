import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Alert,
	Anchor,
	Avatar,
	Box,
	Button,
	Container,
	Divider,
	Drawer,
	Flex,
	FocusTrap,
	Group,
	Image,
	Indicator,
	Input,
	Menu,
	Modal,
	NumberInput,
	Paper,
	ScrollArea,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useDidUpdate, useDisclosure, useInViewport } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	DeleteSeenItemDocument,
	DeployUpdateMetadataJobDocument,
	DisassociateMetadataDocument,
	EntityLot,
	EntityRemoteVideoSource,
	MediaLot,
	MediaSource,
	MergeMetadataDocument,
	MetadataDetailsDocument,
	type MetadataDetailsQuery,
	type MetadataProgressUpdateChange,
	type PodcastEpisode,
	SeenState,
	UpdateSeenItemDocument,
	UserMetadataDetailsDocument,
	type UserMetadataDetailsQuery,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	formatDateToNaiveDate,
	formatQuantityWithCompactNotation,
	getActionIntent,
	humanizeDuration,
	isInteger,
	isNumber,
	isString,
	parseParameters,
	parseSearchQuery,
	processSubmission,
} from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconBubble,
	IconBulb,
	IconEdit,
	IconInfoCircle,
	IconMessageCircle2,
	IconMovie,
	IconPlayerPlay,
	IconRotateClockwise,
	IconStarFilled,
	IconUser,
	IconVideo,
	IconX,
} from "@tabler/icons-react";
import type { HumanizeDurationOptions } from "humanize-duration-ts";
import {
	Fragment,
	type ReactNode,
	type RefObject,
	forwardRef,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { Form, Link, useLoaderData } from "react-router";
import { Virtuoso, VirtuosoGrid, type VirtuosoHandle } from "react-virtuoso";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import {
	DisplayCollection,
	DisplayThreePointReview,
	MEDIA_DETAILS_HEIGHT,
	MediaDetailsLayout,
	ReviewItemDisplay,
} from "~/components/common";
import {
	BaseEntityDisplay,
	MarkEntityAsPartialMenuItem,
	MediaScrollArea,
	PartialMetadataDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import {
	PRO_REQUIRED_MESSAGE,
	Verb,
	clientGqlService,
	dayjsLib,
	getVerb,
	openConfirmationModal,
	refreshEntityDetails,
	reviewYellow,
	zodDateTimeString,
} from "~/lib/common";
import {
	useConfirmSubmit,
	useCoreDetails,
	useDeployBulkMetadataProgressUpdate,
	useGetRandomMantineColor,
	useGetWatchProviders,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import {
	useAddEntityToCollections,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";
import {
	MetadataIdSchema,
	createToastHeaders,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";
import { MetadataSpecificsSchema } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.media.item.$id._index";

const JUST_WATCH_URL = "https://www.justwatch.com";

const searchParamsSchema = z
	.object({ defaultTab: z.string().optional() })
	.merge(MetadataSpecificsSchema);

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { id: metadataId } = parseParameters(
		params,
		z.object({ id: z.string() }),
	);
	const query = parseSearchQuery(request, searchParamsSchema);
	const [{ metadataDetails }, { userMetadataDetails }] = await Promise.all([
		serverGqlService.request(MetadataDetailsDocument, { metadataId }),
		serverGqlService.authenticatedRequest(
			request,
			UserMetadataDetailsDocument,
			{ metadataId },
		),
	]);
	if (metadataDetails.isPartial)
		await serverGqlService.request(DeployUpdateMetadataJobDocument, {
			metadataId,
		});
	return { query, metadataId, metadataDetails, userMetadataDetails };
};

export const meta = ({ data }: Route.MetaArgs) => {
	return [{ title: `${data?.metadataDetails.title} | Ryot` }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("deleteSeenItem", async () => {
			const submission = processSubmission(formData, seenIdSchema);
			await serverGqlService.authenticatedRequest(
				request,
				DeleteSeenItemDocument,
				submission,
			);
			return Response.json({ status: "success", tt: new Date() } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Record deleted successfully",
				}),
			});
		})
		.with("mergeMetadata", async () => {
			const submission = processSubmission(formData, mergeMetadataSchema);
			await serverGqlService.authenticatedRequest(
				request,
				MergeMetadataDocument,
				submission,
			);
			return redirectWithToast(
				$path("/media/item/:id", { id: submission.mergeInto }),
				{ type: "success", message: "Metadata merged successfully" },
			);
		})
		.with("editSeenItem", async () => {
			const submission = processSubmission(formData, editSeenItem);
			submission.reviewId = submission.reviewId || "";
			await serverGqlService.authenticatedRequest(
				request,
				UpdateSeenItemDocument,
				{ input: submission },
			);
			return Response.json({ status: "success", tt: new Date() } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Edited history item successfully",
				}),
			});
		})
		.with("removeItem", async () => {
			const submission = processSubmission(formData, MetadataIdSchema);
			await serverGqlService.authenticatedRequest(
				request,
				DisassociateMetadataDocument,
				submission,
			);
			return redirectWithToast($path("/"), {
				type: "success",
				message: "Removed item successfully",
			});
		})
		.run();
};

const seenIdSchema = z.object({ seenId: z.string() });

const mergeMetadataSchema = z.object({
	mergeFrom: z.string(),
	mergeInto: z.string(),
});

const editSeenItem = z.object({
	seenId: z.string(),
	reviewId: z.string().optional(),
	startedOn: zodDateTimeString.optional(),
	finishedOn: zodDateTimeString.optional(),
	manualTimeSpent: z.string().optional(),
	providerWatchedOn: z.string().optional(),
});

const METADATA_LOTS_WITH_GRANULAR_UPDATES = [
	MediaLot.Show,
	MediaLot.Anime,
	MediaLot.Manga,
	MediaLot.Podcast,
];

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const userDetails = useUserDetails();
	const submit = useConfirmSubmit();
	const canCurrentUserUpdate =
		loaderData.metadataDetails.source === MediaSource.Custom &&
		userDetails.id === loaderData.metadataDetails.createdByUserId;
	const [tab, setTab] = useState<string | null>(
		loaderData.query.defaultTab || "overview",
	);
	const podcastVirtuosoRef = useRef<VirtuosoHandle>(null);
	const reviewsVirtuosoRef = useRef<VirtuosoHandle>(null);
	const [
		mergeMetadataModalOpened,
		{ open: mergeMetadataModalOpen, close: mergeMetadataModalClose },
	] = useDisclosure(false);
	const [_m, setMetadataToUpdate] = useMetadataProgressUpdate();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();
	const [openedShowSeason, setOpenedShowSeason] = useState<number>();
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const deployBulkMetadataProgressUpdate = useDeployBulkMetadataProgressUpdate(
		loaderData.metadataDetails.title,
	);

	const changeProgress = useCallback(
		(change: MetadataProgressUpdateChange) =>
			deployBulkMetadataProgressUpdate.mutate([
				{ change, metadataId: loaderData.metadataId },
			]),
		[deployBulkMetadataProgressUpdate.mutate, loaderData.metadataId],
	);

	const changeProgressState = useCallback(
		(state: SeenState) => changeProgress({ changeLatestInProgress: { state } }),
		[changeProgress],
	);

	const inProgress = loaderData.userMetadataDetails.inProgress;
	const nextEntry = loaderData.userMetadataDetails.nextEntry;
	const firstGroupAssociated = loaderData.metadataDetails.group.at(0);
	const videos = [...loaderData.metadataDetails.assets.remoteVideos];
	const additionalMetadataDetails = [
		userPreferences.featuresEnabled.media.groups && firstGroupAssociated && (
			<Link
				key="group-link"
				style={{ color: "unset" }}
				to={$path("/media/groups/item/:id", {
					id: firstGroupAssociated.id,
				})}
			>
				<Text c="dimmed" fs="italic" span>
					{firstGroupAssociated.name} #{firstGroupAssociated.part}
				</Text>
			</Link>
		),
		loaderData.metadataDetails.publishDate
			? dayjsLib(loaderData.metadataDetails.publishDate).format("LL")
			: loaderData.metadataDetails.publishYear,
		loaderData.metadataDetails.originalLanguage,
		loaderData.metadataDetails.productionStatus,
		loaderData.metadataDetails.bookSpecifics?.pages &&
			`${loaderData.metadataDetails.bookSpecifics.pages} pages`,
		loaderData.metadataDetails.bookSpecifics?.isCompilation && "Compilation",
		loaderData.metadataDetails.podcastSpecifics?.totalEpisodes &&
			`${loaderData.metadataDetails.podcastSpecifics.totalEpisodes} episodes`,
		loaderData.metadataDetails.animeSpecifics?.episodes &&
			`${loaderData.metadataDetails.animeSpecifics.episodes} episodes`,
		loaderData.metadataDetails.mangaSpecifics?.chapters &&
			`${loaderData.metadataDetails.mangaSpecifics.chapters} chapters`,
		loaderData.metadataDetails.mangaSpecifics?.volumes &&
			`${loaderData.metadataDetails.mangaSpecifics.volumes} volumes`,
		loaderData.metadataDetails.movieSpecifics?.runtime &&
			humanizeDuration(
				dayjsLib
					.duration(loaderData.metadataDetails.movieSpecifics.runtime, "minute")
					.asMilliseconds(),
			),
		loaderData.metadataDetails.showSpecifics?.totalSeasons &&
			`${loaderData.metadataDetails.showSpecifics.totalSeasons} seasons`,
		loaderData.metadataDetails.showSpecifics?.totalEpisodes &&
			`${loaderData.metadataDetails.showSpecifics.totalEpisodes} episodes`,
		loaderData.metadataDetails.showSpecifics?.runtime &&
			humanizeDuration(
				dayjsLib
					.duration(loaderData.metadataDetails.showSpecifics.runtime, "minute")
					.asMilliseconds(),
			),
		loaderData.metadataDetails.audioBookSpecifics?.runtime &&
			humanizeDuration(
				dayjsLib
					.duration(
						loaderData.metadataDetails.audioBookSpecifics.runtime,
						"minute",
					)
					.asMilliseconds(),
			),
		loaderData.metadataDetails.musicSpecifics?.duration &&
			humanizeDuration(
				dayjsLib
					.duration(
						loaderData.metadataDetails.musicSpecifics.duration,
						"second",
					)
					.asMilliseconds(),
			),
		loaderData.metadataDetails.musicSpecifics?.viewCount &&
			formatQuantityWithCompactNotation(
				loaderData.metadataDetails.musicSpecifics.viewCount,
			),
		loaderData.metadataDetails.musicSpecifics?.byVariousArtists &&
			"Various Artists",
	].filter(Boolean);

	const PutOnHoldMenuItem = () => {
		return (
			<Menu.Item onClick={() => changeProgressState(SeenState.OnAHold)}>
				Put on hold
			</Menu.Item>
		);
	};
	const DropMenuItem = () => {
		return (
			<Menu.Item onClick={() => changeProgressState(SeenState.Dropped)}>
				Mark as dropped
			</Menu.Item>
		);
	};
	const StateChangeButtons = () => {
		return (
			<>
				<PutOnHoldMenuItem />
				<DropMenuItem />
			</>
		);
	};

	return (
		<>
			<DisplayShowSeasonEpisodesModal
				openedShowSeason={openedShowSeason}
				setOpenedShowSeason={setOpenedShowSeason}
			/>
			<Container>
				<MediaDetailsLayout
					title={loaderData.metadataDetails.title}
					assets={loaderData.metadataDetails.assets}
					externalLink={{
						lot: loaderData.metadataDetails.lot,
						source: loaderData.metadataDetails.source,
						href: loaderData.metadataDetails.sourceUrl,
					}}
					partialDetailsFetcher={{
						entityId: loaderData.metadataDetails.id,
						isAlreadyPartial: loaderData.metadataDetails.isPartial,
						fn: () =>
							clientGqlService
								.request(MetadataDetailsDocument, {
									metadataId: loaderData.metadataDetails.id,
								})
								.then((data) => data.metadataDetails.isPartial),
					}}
				>
					{loaderData.userMetadataDetails.collections.length > 0 ? (
						<Group>
							{loaderData.userMetadataDetails.collections.map((col) => (
								<DisplayCollection
									col={col}
									key={col.id}
									creatorUserId={col.userId}
									entityLot={EntityLot.Metadata}
									entityId={loaderData.metadataId}
								/>
							))}
						</Group>
					) : null}
					{additionalMetadataDetails.length > 0 ? (
						<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
							{additionalMetadataDetails
								.map<ReactNode>((s) => s)
								.reduce((prev, curr) => [prev, " • ", curr])}
						</Text>
					) : null}
					{loaderData.metadataDetails.providerRating ||
					loaderData.userMetadataDetails.averageRating ? (
						<Group>
							{loaderData.metadataDetails.providerRating ? (
								<Paper
									p={4}
									display="flex"
									style={{
										flexDirection: "column",
										alignItems: "center",
										gap: 6,
									}}
								>
									<Image
										alt="Logo"
										h={24}
										w={24}
										src={`/provider-logos/${match(
											loaderData.metadataDetails.source,
										)
											.with(MediaSource.Anilist, () => "anilist.svg")
											.with(MediaSource.Audible, () => "audible.svg")
											.with(MediaSource.GoogleBooks, () => "google-books.svg")
											.with(MediaSource.Igdb, () => "igdb.svg")
											.with(MediaSource.Itunes, () => "itunes.svg")
											.with(MediaSource.Listennotes, () => "listennotes.webp")
											.with(MediaSource.Myanimelist, () => "mal.svg")
											.with(MediaSource.MangaUpdates, () => "manga-updates.svg")
											.with(MediaSource.Openlibrary, () => "openlibrary.svg")
											.with(MediaSource.Tmdb, () => "tmdb.svg")
											.with(MediaSource.Vndb, () => "vndb.ico")
											.with(MediaSource.YoutubeMusic, () => "youtube-music.png")
											.with(MediaSource.Hardcover, () => "hardcover.png")
											.with(MediaSource.Custom, () => undefined)
											.exhaustive()}`}
									/>
									<Text fz="sm">
										{Number(loaderData.metadataDetails.providerRating).toFixed(
											1,
										)}
										{match(loaderData.metadataDetails.source)
											.with(
												MediaSource.Igdb,
												MediaSource.Tmdb,
												MediaSource.Vndb,
												MediaSource.Anilist,
												MediaSource.Listennotes,
												() => "%",
											)
											.with(
												MediaSource.Audible,
												MediaSource.Hardcover,
												MediaSource.GoogleBooks,
												() => "/5",
											)
											.with(
												MediaSource.Myanimelist,
												MediaSource.MangaUpdates,
												() => "/10",
											)
											.with(
												MediaSource.Custom,
												MediaSource.Itunes,
												MediaSource.Openlibrary,
												MediaSource.YoutubeMusic,
												() => undefined,
											)
											.exhaustive()}
									</Text>
								</Paper>
							) : null}
							{loaderData.userMetadataDetails.averageRating
								? match(userPreferences.general.reviewScale)
										.with(UserReviewScale.ThreePointSmiley, () => (
											<DisplayThreePointReview
												size={40}
												rating={loaderData.userMetadataDetails.averageRating}
											/>
										))
										.otherwise(() => (
											<Paper
												p={4}
												display="flex"
												style={{
													gap: 6,
													alignItems: "center",
													flexDirection: "column",
												}}
											>
												<IconStarFilled
													size={22}
													style={{ color: reviewYellow }}
												/>
												<Text fz="sm">
													{Number(
														loaderData.userMetadataDetails.averageRating,
													).toFixed(1)}
													{userPreferences.general.reviewScale ===
													UserReviewScale.OutOfHundred
														? "%"
														: undefined}
													{userPreferences.general.reviewScale ===
													UserReviewScale.OutOfTen
														? "/10"
														: undefined}
												</Text>
											</Paper>
										))
								: null}
						</Group>
					) : null}
					{inProgress ? (
						<Alert icon={<IconAlertCircle />} variant="outline">
							You are currently{" "}
							{getVerb(Verb.Read, loaderData.metadataDetails.lot)}
							ing{" "}
							{inProgress.podcastExtraInformation
								? `EP-${inProgress.podcastExtraInformation.episode}`
								: inProgress.showExtraInformation
									? `S${inProgress.showExtraInformation.season}-E${inProgress.showExtraInformation.episode}`
									: "this"}{" "}
							({Number(inProgress.progress).toFixed(2)}
							%)
						</Alert>
					) : null}
					<Tabs variant="outline" value={tab} onChange={(t) => setTab(t)}>
						<Tabs.List mb="xs">
							<Tabs.Tab
								value="overview"
								leftSection={<IconInfoCircle size={16} />}
							>
								Overview
							</Tabs.Tab>
							<Tabs.Tab
								value="actions"
								leftSection={<IconUser size={16} />}
								onClick={() => advanceOnboardingTourStep()}
								className={OnboardingTourStepTargets.MetadataDetailsActionsTab}
							>
								Actions
							</Tabs.Tab>
							<Tabs.Tab
								value="history"
								leftSection={<IconRotateClockwise size={16} />}
							>
								History
							</Tabs.Tab>
							{loaderData.metadataDetails.lot === MediaLot.Show ? (
								<Tabs.Tab
									value="showSeasons"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Seasons
								</Tabs.Tab>
							) : null}
							{loaderData.metadataDetails.lot === MediaLot.Podcast ? (
								<Tabs.Tab
									value="podcastEpisodes"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Episodes
								</Tabs.Tab>
							) : null}
							{!userPreferences.general.disableReviews ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : null}
							<Tabs.Tab
								value="suggestions"
								leftSection={<IconBulb size={16} />}
							>
								Suggestions
							</Tabs.Tab>
							{!userPreferences.general.disableVideos && videos.length > 0 ? (
								<Tabs.Tab value="videos" leftSection={<IconVideo size={16} />}>
									Videos
								</Tabs.Tab>
							) : null}
							{!userPreferences.general.disableWatchProviders ? (
								<Tabs.Tab
									value="watchProviders"
									leftSection={<IconMovie size={16} />}
								>
									Watch On
								</Tabs.Tab>
							) : null}
						</Tabs.List>
						<Tabs.Panel value="overview">
							<MediaScrollArea>
								<Stack gap="sm">
									<SimpleGrid
										cols={{ base: 3, xl: 4 }}
										spacing={{ base: "md", lg: "xs" }}
									>
										{userPreferences.featuresEnabled.media.genres
											? loaderData.metadataDetails.genres
													.slice(0, 12)
													.map((g) => {
														const color = useGetRandomMantineColor(g.name);
														return (
															<Group key={g.id} wrap="nowrap">
																<Box
																	h={11}
																	w={11}
																	bg={color}
																	style={{ borderRadius: 2, flex: "none" }}
																/>
																<Anchor
																	component={Link}
																	to={$path("/media/genre/:id", {
																		id: g.id,
																	})}
																	fz="sm"
																	truncate
																>
																	{g.name.trim()}
																</Anchor>
															</Group>
														);
													})
											: null}
									</SimpleGrid>
									{loaderData.metadataDetails.description ? (
										<div
											// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
											dangerouslySetInnerHTML={{
												__html: loaderData.metadataDetails.description,
											}}
										/>
									) : null}
									{userPreferences.featuresEnabled.media.people ? (
										<Stack>
											{loaderData.metadataDetails.creators.map((c) => (
												<Box key={c.name}>
													<Text fw="bold">{c.name}</Text>
													<ScrollArea
														mt="xs"
														w={{
															base: 380,
															xs: 440,
															sm: 480,
															md: 520,
															lg: 580,
														}}
													>
														<Flex gap="md">
															{c.items.map((creator) => (
																<MetadataCreator
																	name={creator.name}
																	image={creator.image}
																	id={creator.id || undefined}
																	character={creator.character}
																	key={`${creator.id}-${creator.name}`}
																/>
															))}
														</Flex>
													</ScrollArea>
												</Box>
											))}
										</Stack>
									) : null}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="actions">
							<MergeMetadataModal
								onClose={mergeMetadataModalClose}
								opened={mergeMetadataModalOpened}
								metadataId={loaderData.metadataId}
							/>
							<MediaScrollArea>
								<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
									<Menu shadow="md">
										<Menu.Target>
											<Button variant="outline">Update progress</Button>
										</Menu.Target>
										<Menu.Dropdown>
											{loaderData.metadataDetails.lot === MediaLot.Show ? (
												<>
													<Menu.Label>Shows</Menu.Label>
													{nextEntry ? (
														<>
															<Menu.Item
																onClick={() => {
																	setMetadataToUpdate({
																		metadataId: loaderData.metadataId,
																		showSeasonNumber: nextEntry.season,
																		showEpisodeNumber: nextEntry.episode,
																	});
																}}
															>
																Mark{" "}
																{`S${nextEntry.season}-E${nextEntry.episode}`}{" "}
																as seen
															</Menu.Item>
															<PutOnHoldMenuItem />
														</>
													) : null}
													{loaderData.userMetadataDetails.history.length !==
													0 ? (
														<DropMenuItem />
													) : (
														<Menu.Item disabled>
															No history. Update from the seasons tab.
														</Menu.Item>
													)}
												</>
											) : null}
											{loaderData.metadataDetails.lot === MediaLot.Anime ? (
												<>
													<Menu.Label>Anime</Menu.Label>
													<Menu.Item
														onClick={() => {
															setMetadataToUpdate({
																metadataId: loaderData.metadataId,
																animeEpisodeNumber: nextEntry?.episode || 1,
															});
														}}
													>
														Mark EP-
														{nextEntry?.episode || 1} as watched
													</Menu.Item>
													{nextEntry ? <PutOnHoldMenuItem /> : null}
													{loaderData.userMetadataDetails.history.length !==
													0 ? (
														<DropMenuItem />
													) : null}
												</>
											) : null}
											{loaderData.metadataDetails.lot === MediaLot.Manga ? (
												<>
													<Menu.Label>Manga</Menu.Label>
													<Menu.Item
														onClick={() => {
															setMetadataToUpdate({
																metadataId: loaderData.metadataId,
																mangaVolumeNumber: nextEntry?.volume,
																mangaChapterNumber: nextEntry?.chapter,
															});
														}}
													>
														Mark{" "}
														{nextEntry &&
															(nextEntry.chapter
																? `CH-${nextEntry.chapter}`
																: `VOL-${nextEntry.volume}`)}{" "}
														as read
													</Menu.Item>
													{nextEntry ? <PutOnHoldMenuItem /> : null}
													{loaderData.userMetadataDetails.history.length !==
													0 ? (
														<DropMenuItem />
													) : null}
												</>
											) : null}
											{loaderData.metadataDetails.lot === MediaLot.Podcast ? (
												<>
													<Menu.Label>Podcasts</Menu.Label>
													{nextEntry ? (
														<>
															<Menu.Item
																onClick={() => {
																	setMetadataToUpdate({
																		metadataId: loaderData.metadataId,
																		podcastEpisodeNumber: nextEntry.episode,
																	});
																}}
															>
																Mark EP-
																{nextEntry.episode} as listened
															</Menu.Item>
															<PutOnHoldMenuItem />
														</>
													) : null}
													{loaderData.userMetadataDetails.history.length !==
													0 ? (
														<DropMenuItem />
													) : (
														<Menu.Item disabled>
															No history. Update from the episodes tab.
														</Menu.Item>
													)}
												</>
											) : null}
											{loaderData.userMetadataDetails?.inProgress ? (
												<>
													<Menu.Label>In progress</Menu.Label>
													<Menu.Item
														onClick={() => {
															setMetadataToUpdate({
																metadataId: loaderData.metadataId,
															});
														}}
													>
														Set progress
													</Menu.Item>
													{!METADATA_LOTS_WITH_GRANULAR_UPDATES.includes(
														loaderData.metadataDetails.lot,
													) ? (
														<StateChangeButtons />
													) : null}
													<Menu.Item
														onClick={() =>
															changeProgress({
																changeLatestInProgress: { progress: "100" },
															})
														}
													>
														I finished it
													</Menu.Item>
												</>
											) : !METADATA_LOTS_WITH_GRANULAR_UPDATES.includes(
													loaderData.metadataDetails.lot,
												) ? (
												<>
													<Menu.Label>Not in progress</Menu.Label>
													{![MediaLot.Anime, MediaLot.Manga].includes(
														loaderData.metadataDetails.lot,
													) ? (
														<Menu.Item
															onClick={() =>
																changeProgress({
																	createNewInProgress: {
																		startedOn: formatDateToNaiveDate(
																			new Date(),
																		),
																	},
																})
															}
														>
															I'm{" "}
															{getVerb(
																Verb.Read,
																loaderData.metadataDetails.lot,
															)}
															ing it
														</Menu.Item>
													) : null}
													<Menu.Item
														onClick={() => {
															setMetadataToUpdate({
																metadataId: loaderData.metadataId,
															});
														}}
													>
														Add to{" "}
														{getVerb(Verb.Read, loaderData.metadataDetails.lot)}{" "}
														history
													</Menu.Item>
												</>
											) : null}
										</Menu.Dropdown>
									</Menu>
									{!userPreferences.general.disableReviews ? (
										<Button
											variant="outline"
											w="100%"
											onClick={() => {
												setEntityToReview({
													entityId: loaderData.metadataId,
													entityLot: EntityLot.Metadata,
													entityTitle: loaderData.metadataDetails.title,
													metadataLot: loaderData.metadataDetails.lot,
													existingReview: {
														showExtraInformation: {
															episode:
																loaderData.userMetadataDetails?.nextEntry
																	?.episode || undefined,
															season:
																loaderData.userMetadataDetails?.nextEntry
																	?.season || undefined,
														},
														podcastExtraInformation: {
															episode:
																loaderData.userMetadataDetails?.nextEntry
																	?.episode || undefined,
														},
														mangaExtraInformation: {
															chapter:
																loaderData.userMetadataDetails?.nextEntry
																	?.chapter || undefined,
														},
														animeExtraInformation: {
															episode:
																loaderData.userMetadataDetails?.nextEntry
																	?.episode || undefined,
														},
													},
												});
											}}
										>
											Post a review
										</Button>
									) : null}
									<Button
										variant="outline"
										onClick={() => {
											setAddEntityToCollectionsData({
												entityId: loaderData.metadataId,
												entityLot: EntityLot.Metadata,
												alreadyInCollections:
													loaderData.userMetadataDetails.collections.map(
														(c) => c.id,
													),
											});
										}}
									>
										Add to collection
									</Button>
									<Menu shadow="md">
										<Menu.Target>
											<Button variant="outline">More actions</Button>
										</Menu.Target>
										<Menu.Dropdown>
											<ToggleMediaMonitorMenuItem
												inCollections={loaderData.userMetadataDetails.collections.map(
													(c) => c.name,
												)}
												formValue={loaderData.metadataId}
												entityLot={EntityLot.Metadata}
											/>
											<Menu.Item onClick={mergeMetadataModalOpen}>
												Merge media
											</Menu.Item>
											<Form
												method="POST"
												action={withQuery(".", { intent: "removeItem" })}
											>
												<input
													hidden
													name="metadataId"
													defaultValue={loaderData.metadataId}
												/>
												<Menu.Item
													color="red"
													onClick={(e) => {
														const form = e.currentTarget.form;
														e.preventDefault();
														openConfirmationModal(
															"Are you sure you want to remove this item? This will remove it from all collections and delete all history and reviews.",
															() => submit(form),
														);
													}}
												>
													Remove item
												</Menu.Item>
											</Form>
											<MarkEntityAsPartialMenuItem
												entityLot={EntityLot.Metadata}
												entityId={loaderData.metadataId}
											/>
										</Menu.Dropdown>
									</Menu>
									{canCurrentUserUpdate ? (
										<Button
											component={Link}
											variant="outline"
											to={$path(
												"/media/update/:action",
												{ action: "edit" },
												{ id: loaderData.metadataDetails.id },
											)}
										>
											Edit metadata
										</Button>
									) : null}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="history">
							{loaderData.userMetadataDetails.seenByAllCount > 0 ||
							loaderData.userMetadataDetails.seenByUserCount > 0 ? (
								<Stack h={MEDIA_DETAILS_HEIGHT} gap="xs">
									<Box>
										<Text fz={{ base: "sm", md: "md" }}>
											Seen by all users{" "}
											{loaderData.userMetadataDetails.seenByAllCount} time
											{loaderData.userMetadataDetails.seenByAllCount > 1
												? "s"
												: ""}{" "}
											and {loaderData.userMetadataDetails.seenByUserCount} time
											{loaderData.userMetadataDetails &&
											loaderData.userMetadataDetails.seenByUserCount > 1
												? "s"
												: ""}{" "}
											by you.
										</Text>
									</Box>
									<Virtuoso
										data={loaderData.userMetadataDetails.history}
										itemContent={(index, history) => (
											<HistoryItem
												index={index}
												setTab={setTab}
												key={history.id}
												history={history}
												reviewsVirtuosoRef={reviewsVirtuosoRef}
												podcastVirtuosoRef={podcastVirtuosoRef}
											/>
										)}
									/>
								</Stack>
							) : (
								<Text>No history</Text>
							)}
						</Tabs.Panel>
						<Tabs.Panel value="showSeasons" h={MEDIA_DETAILS_HEIGHT}>
							{loaderData.metadataDetails.showSpecifics &&
							loaderData.userMetadataDetails.showProgress ? (
								<Virtuoso
									data={loaderData.metadataDetails.showSpecifics.seasons}
									itemContent={(seasonIdx, season) => (
										<DisplayShowSeason
											season={season}
											seasonIdx={seasonIdx}
											key={season.seasonNumber}
											openSeasonModal={() => setOpenedShowSeason(seasonIdx)}
										/>
									)}
								/>
							) : null}
						</Tabs.Panel>
						{loaderData.metadataDetails.podcastSpecifics ? (
							<Tabs.Panel value="podcastEpisodes" h={MEDIA_DETAILS_HEIGHT}>
								<Virtuoso
									ref={podcastVirtuosoRef}
									data={loaderData.metadataDetails.podcastSpecifics.episodes}
									itemContent={(podcastEpisodeIdx, podcastEpisode) => (
										<DisplayPodcastEpisode
											key={podcastEpisode.id}
											episode={podcastEpisode}
											index={podcastEpisodeIdx}
											podcastProgress={
												loaderData.userMetadataDetails.podcastProgress
											}
										/>
									)}
								/>
							</Tabs.Panel>
						) : null}
						{!userPreferences.general.disableReviews ? (
							<Tabs.Panel value="reviews" h={MEDIA_DETAILS_HEIGHT}>
								{loaderData.userMetadataDetails.reviews.length > 0 ? (
									<Virtuoso
										ref={reviewsVirtuosoRef}
										data={loaderData.userMetadataDetails.reviews}
										itemContent={(_review, r) => (
											<ReviewItemDisplay
												key={r.id}
												review={r}
												entityLot={EntityLot.Metadata}
												entityId={loaderData.metadataId}
												lot={loaderData.metadataDetails.lot}
												title={loaderData.metadataDetails.title}
											/>
										)}
									/>
								) : (
									<Text>No reviews</Text>
								)}
							</Tabs.Panel>
						) : null}
						<Tabs.Panel value="suggestions" h={MEDIA_DETAILS_HEIGHT}>
							{loaderData.metadataDetails.suggestions.length > 0 ? (
								<VirtuosoGrid
									components={{
										List: forwardRef((props, ref) => (
											<SimpleGrid
												ref={ref}
												{...props}
												cols={{ base: 3, md: 4, lg: 5 }}
											/>
										)),
									}}
									totalCount={loaderData.metadataDetails.suggestions.length}
									itemContent={(index) => (
										<PartialMetadataDisplay
											metadataId={loaderData.metadataDetails.suggestions[index]}
										/>
									)}
								/>
							) : (
								<Text>No suggestions</Text>
							)}
						</Tabs.Panel>
						{!userPreferences.general.disableVideos ? (
							<Tabs.Panel value="videos">
								<MediaScrollArea>
									<Stack>
										{videos.map((v) => (
											<VideoIframe
												key={v.url}
												videoId={v.url}
												videoSource={v.source}
											/>
										))}
									</Stack>
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
						{!userPreferences.general.disableWatchProviders ? (
							<Tabs.Panel value="watchProviders">
								{loaderData.metadataDetails.watchProviders.length > 0 ? (
									<MediaScrollArea>
										<Stack gap="sm">
											<Text>
												JustWatch makes it easy to find out where you can
												legally watch your favorite movies & TV shows online.
												Visit <Anchor href={JUST_WATCH_URL}>JustWatch</Anchor>{" "}
												for more information.
											</Text>
											<Text>
												The following is a list of all available watch providers
												for this media along with the countries they are
												available in.
											</Text>
											{loaderData.metadataDetails.watchProviders.map(
												(provider) => (
													<Flex key={provider.name} align="center" gap="md">
														<Image
															src={provider.image}
															h={80}
															w={80}
															radius="md"
														/>
														<Text lineClamp={3}>
															{provider.name}:{" "}
															<Text size="xs" span>
																{provider.languages.join(", ")}
															</Text>
														</Text>
													</Flex>
												),
											)}
										</Stack>
									</MediaScrollArea>
								) : (
									<Text>No watch providers</Text>
								)}
							</Tabs.Panel>
						) : null}
					</Tabs>
				</MediaDetailsLayout>
			</Container>
		</>
	);
}

const VideoIframe = (props: {
	videoId: string;
	videoSource: EntityRemoteVideoSource;
}) => {
	const [isMounted, setIsMounted] = useState(false);
	const { ref, inViewport } = useInViewport();

	useDidUpdate(() => {
		if (inViewport) setIsMounted(true);
	}, [inViewport]);

	return (
		<Box ref={ref}>
			{isMounted ? (
				<iframe
					width="100%"
					height={200}
					src={
						match(props.videoSource)
							.with(
								EntityRemoteVideoSource.Youtube,
								() => "https://www.youtube.com/embed/",
							)
							.with(
								EntityRemoteVideoSource.Dailymotion,
								() => "https://www.dailymotion.com/embed/video/",
							)
							.exhaustive() + props.videoId
					}
					title="Video player"
					allowFullScreen
				/>
			) : null}
		</Box>
	);
};

const DisplayShowSeasonEpisodesModal = (props: {
	openedShowSeason: number | undefined;
	setOpenedShowSeason: (v: number | undefined) => void;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const title = useMemo(() => {
		const showSpecifics = loaderData.metadataDetails.showSpecifics;
		return isNumber(props.openedShowSeason) && showSpecifics
			? getShowSeasonDisplayName(showSpecifics.seasons[props.openedShowSeason])
			: "";
	}, [props.openedShowSeason]);

	return (
		<Drawer
			title={title}
			opened={props.openedShowSeason !== undefined}
			onClose={() => props.setOpenedShowSeason(undefined)}
		>
			{isNumber(props.openedShowSeason) ? (
				<DisplayShowSeasonEpisodes
					openedShowSeason={props.openedShowSeason}
					setOpenedShowSeason={props.setOpenedShowSeason}
				/>
			) : null}
		</Drawer>
	);
};

const DisplayShowSeasonEpisodes = (props: {
	openedShowSeason: number;
	setOpenedShowSeason: (v: number | undefined) => void;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const season =
		loaderData.metadataDetails.showSpecifics?.seasons[props.openedShowSeason];
	const seasonProgress =
		loaderData.userMetadataDetails.showProgress?.[props.openedShowSeason];

	return isNumber(props.openedShowSeason) && season ? (
		<Stack h={{ base: "80vh", md: "90vh" }} gap="xs">
			{season.episodes.length > 0 ? (
				<Virtuoso
					data={season.episodes}
					itemContent={(episodeIdx, episode) => (
						<DisplayShowEpisode
							episode={episode}
							episodeIdx={episodeIdx}
							seasonNumber={season.seasonNumber}
							seasonIdx={props.openedShowSeason}
							episodeProgress={seasonProgress?.episodes[episodeIdx]}
							beforeOpenModal={() => props.setOpenedShowSeason(undefined)}
						/>
					)}
				/>
			) : (
				<Text>No episodes found</Text>
			)}
		</Stack>
	) : null;
};

const MetadataCreator = (props: {
	id?: string;
	name: string;
	image?: string | null;
	character?: string | null;
}) => {
	return (
		<BaseEntityDisplay
			image={props.image || undefined}
			title={`${props.name} ${props.character ? `as ${props.character}` : ""}`}
			link={
				props.id ? $path("/media/people/item/:id", { id: props.id }) : undefined
			}
		/>
	);
};

type History =
	UserMetadataDetailsQuery["userMetadataDetails"]["history"][number];

// DEV: Needs to be done because dayjs calculates the second duration of month based on the
// current calendar month, which messes up the value calculated by humanize-duration-ts.
const SECONDS_IN_MONTH = 2629800;
const POSSIBLE_DURATION_UNITS = ["mo", "d", "h", "min"] as const;

const convertSecondsToDuration = (totalSeconds?: string | null) => {
	if (!totalSeconds) return {};
	const seconds = Number(totalSeconds);
	const mo = Math.floor(seconds / SECONDS_IN_MONTH);
	const remainingSeconds = seconds - mo * SECONDS_IN_MONTH;
	const remainingDuration = dayjsLib.duration(remainingSeconds, "seconds");
	const d = Math.floor(remainingDuration.asDays());
	const h = Math.floor(remainingDuration.subtract(d, "day").asHours());
	const min = Math.floor(
		remainingDuration.subtract(d, "day").subtract(h, "hour").asMinutes(),
	);
	return {
		mo: mo || undefined,
		d: d || undefined,
		h: h || undefined,
		min: min || undefined,
	};
};

type DurationInput = {
	[K in (typeof POSSIBLE_DURATION_UNITS)[number]]?: number;
};

const convertDurationToSeconds = (duration: DurationInput) => {
	let total = 0;
	total += (duration.mo || 0) * SECONDS_IN_MONTH;
	total += dayjsLib.duration(duration.d || 0, "days").asSeconds();
	total += dayjsLib.duration(duration.h || 0, "hours").asSeconds();
	total += dayjsLib.duration(duration.min || 0, "minutes").asSeconds();
	return total;
};

const EditHistoryItemModal = (props: {
	opened: boolean;
	onClose: () => void;
	seen: History;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const userDetails = useUserDetails();
	const reviewsByThisCurrentUser =
		loaderData.userMetadataDetails.reviews.filter(
			(r) => r.postedBy.id === userDetails.id,
		);
	const { startedOn, finishedOn, id, manualTimeSpent, providerWatchedOn } =
		props.seen;
	const coreDetails = useCoreDetails();
	const isNotCompleted = props.seen.state !== SeenState.Completed;
	const watchProviders = useGetWatchProviders(loaderData.metadataDetails.lot);
	const [manualTimeSpentValue, setManualTimeSpentValue] =
		useState<DurationInput>(convertSecondsToDuration(manualTimeSpent));
	const manualTimeSpentInSeconds =
		convertDurationToSeconds(manualTimeSpentValue);

	return (
		<Modal
			centered
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
		>
			<FocusTrap.InitialFocus />
			<Form
				replace
				method="POST"
				onSubmit={props.onClose}
				action={withQuery(".", { intent: "editSeenItem" })}
			>
				<input hidden name="seenId" defaultValue={id} />
				<Stack>
					<Title order={3}>Edit history record</Title>
					<DateTimePicker
						label="Start Date & Time"
						name="startedOn"
						defaultValue={startedOn ? new Date(startedOn) : undefined}
						disabled={isNotCompleted}
					/>
					<DateTimePicker
						label="End Date & Time"
						name="finishedOn"
						defaultValue={finishedOn ? new Date(finishedOn) : undefined}
						disabled={isNotCompleted}
					/>
					<Select
						data={watchProviders}
						label={`Where did you ${getVerb(
							Verb.Read,
							loaderData.metadataDetails.lot,
						)} it?`}
						name="providerWatchedOn"
						defaultValue={providerWatchedOn}
						nothingFoundMessage="No watch providers configured. Please add them in your general preferences."
					/>
					<Tooltip
						label={PRO_REQUIRED_MESSAGE}
						disabled={coreDetails.isServerKeyValidated}
					>
						<Select
							clearable
							searchable
							limit={5}
							name="reviewId"
							disabled={!coreDetails.isServerKeyValidated}
							label="Associate with a review"
							defaultValue={props.seen.reviewId}
							data={reviewsByThisCurrentUser.map((r) => ({
								label: [
									r.textOriginal
										? `${r.textOriginal.slice(0, 20)}...`
										: undefined,
									r.rating,
									`(${r.id})`,
								]
									.filter(Boolean)
									.join(" • "),
								value: r.id,
							}))}
						/>
					</Tooltip>
					<Input.Wrapper
						label="Time spent"
						description="How much time did you actually spend on this media?"
					>
						<Tooltip
							label={PRO_REQUIRED_MESSAGE}
							disabled={coreDetails.isServerKeyValidated}
						>
							<Group wrap="nowrap" mt="xs">
								{POSSIBLE_DURATION_UNITS.map((input) => (
									<NumberInput
										key={input}
										rightSectionWidth={36}
										defaultValue={manualTimeSpentValue[input]}
										disabled={!coreDetails.isServerKeyValidated}
										rightSection={<Text size="xs">{input}</Text>}
										onChange={(v) => {
											setManualTimeSpentValue((prev) => ({
												...prev,
												[input]: v,
											}));
										}}
									/>
								))}
								{manualTimeSpentInSeconds > 0 ? (
									<input
										hidden
										readOnly
										name="manualTimeSpent"
										value={manualTimeSpentInSeconds}
									/>
								) : null}
							</Group>
						</Tooltip>
					</Input.Wrapper>
					<Button variant="outline" type="submit">
						Submit
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};

const MergeMetadataModal = (props: {
	opened: boolean;
	metadataId: string;
	onClose: () => void;
}) => {
	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form
				replace
				method="POST"
				action={withQuery(".", { intent: "mergeMetadata" })}
			>
				<input hidden name="mergeFrom" defaultValue={props.metadataId} />
				<Stack>
					<Title order={3}>Merge media</Title>
					<Text>
						This will move all your history, reviews, and collections from the
						source media to the destination media. This action is irreversible.
					</Text>
					<TextInput label="Destination media ID" name="mergeInto" required />
					<Button type="submit" onClick={props.onClose}>
						Submit
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};

const HistoryItem = (props: {
	index: number;
	history: History;
	setTab: (tab: string) => void;
	podcastVirtuosoRef: RefObject<VirtuosoHandle>;
	reviewsVirtuosoRef: RefObject<VirtuosoHandle>;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const submit = useConfirmSubmit();
	const [opened, { open, close }] = useDisclosure(false);
	const showExtraInformation = props.history.showExtraInformation
		? loaderData.metadataDetails.showSpecifics?.seasons
				.find(
					(s) => s.seasonNumber === props.history.showExtraInformation?.season,
				)
				?.episodes.find(
					(e) =>
						e.episodeNumber === props.history.showExtraInformation?.episode,
				)
		: null;
	const scrollToVirtuosoElement = (
		ref: RefObject<VirtuosoHandle>,
		tab: string,
		index?: number,
	) => {
		if (!coreDetails.isServerKeyValidated) {
			notifications.show({
				color: "red",
				message: PRO_REQUIRED_MESSAGE,
			});
			return;
		}
		props.setTab(tab);
		if (!isNumber(index)) return;
		setTimeout(() => {
			const current = ref.current;
			current?.scrollToIndex({ index, behavior: "smooth", align: "start" });
		}, 500);
	};
	const displayShowExtraInformation = showExtraInformation
		? `S${props.history.showExtraInformation?.season}-E${props.history.showExtraInformation?.episode}: ${showExtraInformation.name}`
		: null;
	const podcastExtraInformation = props.history.podcastExtraInformation
		? loaderData.metadataDetails.podcastSpecifics?.episodes.find(
				(e) => e.number === props.history.podcastExtraInformation?.episode,
			)
		: null;
	const displayPodcastExtraInformation = podcastExtraInformation ? (
		<Anchor
			onClick={() =>
				scrollToVirtuosoElement(
					props.podcastVirtuosoRef,
					"podcastEpisodes",
					loaderData.metadataDetails.podcastSpecifics?.episodes.findIndex(
						(e) => e.number === podcastExtraInformation.number,
					),
				)
			}
		>
			EP-{props.history.podcastExtraInformation?.episode}:{" "}
			{podcastExtraInformation.title}
		</Anchor>
	) : null;
	const displayAnimeExtraInformation = isNumber(
		props.history.animeExtraInformation?.episode,
	)
		? `EP-${props.history.animeExtraInformation.episode}`
		: null;
	const displayMangaExtraInformation = (() => {
		const { chapter, volume } = props.history.mangaExtraInformation || {};

		if (chapter != null) {
			const chapterNum = isString(chapter)
				? Number.parseFloat(chapter)
				: chapter;

			if (!Number.isNaN(chapterNum)) {
				const isWholeNumber = isInteger(chapterNum);
				return `CH-${isWholeNumber ? Math.floor(chapterNum) : chapterNum}`;
			}
		}

		if (isNumber(volume)) return `VOL-${volume}`;

		return null;
	})();
	const watchedOnInformation = props.history.providerWatchedOn;

	const filteredDisplayInformation = [
		watchedOnInformation,
		displayShowExtraInformation,
		displayPodcastExtraInformation,
		displayAnimeExtraInformation,
		displayMangaExtraInformation,
	].filter((s) => s !== null);
	const displayAllInformation =
		filteredDisplayInformation.length > 0
			? filteredDisplayInformation
					.map<ReactNode>((s, i) => <Fragment key={i.toString()}>{s}</Fragment>)
					.reduce((prev, curr) => [prev, " • ", curr])
			: null;

	const timeSpentInMilliseconds =
		(props.history.manualTimeSpent
			? Number(props.history.manualTimeSpent)
			: 0) * 1000;
	const units = ["mo", "d", "h"] as HumanizeDurationOptions["units"];
	const isLessThanAnHour =
		timeSpentInMilliseconds < dayjsLib.duration(1, "hour").asMilliseconds();
	if (isLessThanAnHour) units?.push("m");

	return (
		<>
			<Flex
				mb="sm"
				mt={props.index === 0 ? undefined : "sm"}
				key={props.history.id}
				gap={{ base: "xs", md: "lg", xl: "xl" }}
				data-seen-id={props.history.id}
				data-seen-num-times-updated={props.history.numTimesUpdated}
			>
				<Flex direction="column" justify="center">
					<Form
						replace
						method="POST"
						action={withQuery(".", { intent: "deleteSeenItem" })}
					>
						<input hidden name="seenId" defaultValue={props.history.id} />
						<ActionIcon
							color="red"
							type="submit"
							onClick={(e) => {
								const form = e.currentTarget.form;
								e.preventDefault();
								openConfirmationModal(
									"Are you sure you want to delete this record from history?",
									() => {
										submit(form);
										refreshEntityDetails(loaderData.metadataId);
									},
								);
							}}
						>
							<IconX size={20} />
						</ActionIcon>
					</Form>
					<ActionIcon color="blue" onClick={open}>
						<IconEdit size={20} />
					</ActionIcon>
				</Flex>
				<Stack gap={4}>
					<Flex gap="lg" align="center">
						<Text fw="bold">
							{changeCase(props.history.state)}{" "}
							{props.history.progress !== "100"
								? `(${Number(props.history.progress).toFixed(2)}%)`
								: null}
						</Text>
						{props.history.reviewId ? (
							<ActionIcon
								size="xs"
								color="blue"
								onClick={() => {
									scrollToVirtuosoElement(
										props.reviewsVirtuosoRef,
										"reviews",
										loaderData.userMetadataDetails.reviews.findIndex(
											(r) => r.id === props.history.reviewId,
										),
									);
								}}
							>
								<IconBubble />
							</ActionIcon>
						) : null}
						{displayAllInformation ? (
							<Text c="dimmed" size="sm" lineClamp={1}>
								{displayAllInformation}
							</Text>
						) : null}
					</Flex>
					<SimpleGrid
						spacing="md"
						verticalSpacing={2}
						cols={{ base: 1, md: 2 }}
					>
						<Flex gap="xs">
							<Text size="sm">Started:</Text>
							<Text size="sm" fw="bold">
								{props.history.startedOn
									? dayjsLib(props.history.startedOn).format("L")
									: "N/A"}
							</Text>
						</Flex>
						<Flex gap="xs">
							<Text size="sm">Ended:</Text>
							<Text size="sm" fw="bold">
								{props.history.finishedOn
									? dayjsLib(props.history.finishedOn).format("L")
									: "N/A"}
							</Text>
						</Flex>
						{timeSpentInMilliseconds ? (
							<Flex gap="xs">
								<Text size="sm">Time:</Text>
								<Text size="sm" fw="bold">
									{humanizeDuration(timeSpentInMilliseconds, {
										round: true,
										units,
									})}
								</Text>
							</Flex>
						) : null}
						<Flex gap="xs">
							<Text size="sm">Updated:</Text>
							<Text size="sm" fw="bold">
								{dayjsLib(props.history.lastUpdatedOn).format("L")}
							</Text>
						</Flex>
					</SimpleGrid>
				</Stack>
			</Flex>
			<EditHistoryItemModal
				opened={opened}
				onClose={close}
				seen={props.history}
			/>
		</>
	);
};

const DisplaySeasonOrEpisodeDetails = (props: {
	name: string;
	children: ReactNode;
	runtime?: number | null;
	endDate?: string | null;
	overview?: string | null;
	displayIndicator: number;
	onNameClick?: () => void;
	startDate?: string | null;
	id?: number | string | null;
	numEpisodes?: number | null;
	posterImages: Array<string>;
	publishDate?: string | null;
}) => {
	const [parent] = useAutoAnimate();
	const filteredElements = [
		props.runtime
			? humanizeDuration(
					dayjsLib.duration(props.runtime, "minutes").asMilliseconds(),
					{ units: ["h", "m"] },
				)
			: null,
		props.publishDate ? dayjsLib(props.publishDate).format("ll") : null,
		props.numEpisodes ? `${props.numEpisodes} episodes` : null,
		props.startDate && props.endDate
			? `${dayjsLib(props.startDate).format("MM/YYYY")} to ${dayjsLib(
					props.endDate,
				).format("MM/YYYY")}`
			: null,
	].filter((s) => s !== null);
	const display =
		filteredElements.length > 0
			? filteredElements
					.map<ReactNode>((s, i) => (
						<Text size="xs" key={i.toString()} c="dimmed">
							{s}
						</Text>
					))
					.reduce((prev, curr) => [prev, " • ", curr])
			: null;

	const isSeen = props.displayIndicator >= 1;

	const DisplayDetails = () => (
		<>
			{props.onNameClick ? (
				<Anchor onClick={props.onNameClick} lineClamp={2} display="inline">
					{props.name}
				</Anchor>
			) : (
				<Text lineClamp={2}>{props.name}</Text>
			)}
			{display ? (
				<Flex align="center" gap={4}>
					{display}
				</Flex>
			) : null}
		</>
	);

	return (
		<Stack data-episode-id={props.id} ref={parent}>
			<Flex align="center" gap="sm" justify={{ md: "space-between" }}>
				<Group wrap="nowrap">
					<Indicator
						size={16}
						offset={7}
						color="cyan"
						disabled={!isSeen}
						position="bottom-end"
						style={{ zIndex: 0 }}
						label={
							props.displayIndicator === 1
								? "Seen"
								: `Seen × ${props.displayIndicator}`
						}
					>
						<Avatar
							size="lg"
							radius="xl"
							name={props.name}
							src={props.posterImages[0]}
							imageProps={{ loading: "lazy" }}
						/>
					</Indicator>
					<Box visibleFrom="md" ml="sm">
						<DisplayDetails />
					</Box>
				</Group>
				<Box flex={0} ml={{ base: "md", md: 0 }}>
					{props.children}
				</Box>
			</Flex>
			<Box hiddenFrom="md">
				<DisplayDetails />
			</Box>
			{props.overview ? (
				<Text
					size="sm"
					c="dimmed"
					lineClamp={5}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
					dangerouslySetInnerHTML={{ __html: props.overview }}
				/>
			) : null}
		</Stack>
	);
};

type Season = NonNullable<
	MetadataDetailsQuery["metadataDetails"]["showSpecifics"]
>["seasons"][number];
type SeasonProgress = NonNullable<
	UserMetadataDetailsQuery["userMetadataDetails"]["showProgress"]
>[number];

const getShowSeasonDisplayName = (season: Season) =>
	`${season.seasonNumber}. ${season.name}`;

const DisplayShowSeason = (props: {
	season: Season;
	seasonIdx: number;
	openSeasonModal: () => void;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();

	const seasonProgress =
		loaderData.userMetadataDetails.showProgress?.[props.seasonIdx];
	const numTimesSeen = seasonProgress?.timesSeen || 0;
	const isSeen = numTimesSeen > 0;

	return (
		<Box my={props.seasonIdx !== 0 ? "md" : undefined}>
			<DisplaySeasonOrEpisodeDetails
				{...props.season}
				displayIndicator={numTimesSeen}
				numEpisodes={props.season.episodes.length}
				onNameClick={() => props.openSeasonModal()}
				name={getShowSeasonDisplayName(props.season)}
				endDate={props.season.episodes.at(-1)?.publishDate}
				startDate={props.season.episodes.at(0)?.publishDate}
				runtime={props.season.episodes
					.map((e) => e.runtime || 0)
					.reduce((i, a) => i + a, 0)}
			>
				{props.season.episodes.length > 0 ? (
					<Button
						variant={isSeen ? "default" : "outline"}
						size="xs"
						color="blue"
						onClick={() => {
							setMetadataToUpdate({
								metadataId: loaderData.metadataId,
								showSeasonNumber: props.season.seasonNumber,
								showEpisodeNumber: props.season.episodes.at(-1)?.episodeNumber,
								showAllEpisodesBefore: true,
							});
						}}
					>
						{isSeen ? "Watch again" : "Mark as seen"}
					</Button>
				) : null}
			</DisplaySeasonOrEpisodeDetails>
		</Box>
	);
};

const DisplayShowEpisode = (props: {
	seasonIdx: number;
	episodeIdx: number;
	seasonNumber: number;
	beforeOpenModal?: () => void;
	episode: Season["episodes"][number];
	episodeProgress?: SeasonProgress["episodes"][number];
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const numTimesEpisodeSeen = props.episodeProgress?.timesSeen || 0;

	return (
		<Box my="lg" ml="md">
			<DisplaySeasonOrEpisodeDetails
				{...props.episode}
				key={props.episode.episodeNumber}
				name={`${props.episode.episodeNumber}. ${props.episode.name}`}
				publishDate={props.episode.publishDate}
				displayIndicator={numTimesEpisodeSeen}
			>
				<Button
					size="xs"
					color="blue"
					variant={numTimesEpisodeSeen > 0 ? "default" : "outline"}
					onClick={() => {
						if (props.beforeOpenModal) props.beforeOpenModal();
						setMetadataToUpdate({
							metadataId: loaderData.metadataId,
							showSeasonNumber: props.seasonNumber,
							showEpisodeNumber: props.episode.episodeNumber,
						});
					}}
				>
					{numTimesEpisodeSeen > 0 ? "Rewatch this" : "Mark as seen"}
				</Button>
			</DisplaySeasonOrEpisodeDetails>
		</Box>
	);
};

const DisplayPodcastEpisode = (props: {
	index: number;
	episode: PodcastEpisode;
	podcastProgress: UserMetadataDetailsQuery["userMetadataDetails"]["podcastProgress"];
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const numTimesEpisodeSeen =
		props.podcastProgress?.[props.index]?.timesSeen || 0;

	return (
		<Box my={props.index !== 0 ? "md" : undefined}>
			{props.index !== 0 ? <Divider mb="md" /> : null}
			<DisplaySeasonOrEpisodeDetails
				{...props.episode}
				name={props.episode.title}
				posterImages={[props.episode.thumbnail || ""]}
				publishDate={props.episode.publishDate}
				displayIndicator={numTimesEpisodeSeen}
			>
				<Button
					variant={numTimesEpisodeSeen > 0 ? "default" : "outline"}
					color="blue"
					onClick={() => {
						setMetadataToUpdate({
							metadataId: loaderData.metadataId,
							podcastEpisodeNumber: props.episode.number,
						});
					}}
				>
					{numTimesEpisodeSeen > 0 ? "Re-listen this" : "Mark as listened"}
				</Button>
			</DisplaySeasonOrEpisodeDetails>
		</Box>
	);
};
