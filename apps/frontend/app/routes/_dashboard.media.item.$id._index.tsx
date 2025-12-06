import {
	Alert,
	Anchor,
	Box,
	Button,
	Container,
	Flex,
	Group,
	Image,
	Menu,
	Paper,
	ScrollArea,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	DeleteSeenItemDocument,
	DisassociateMetadataDocument,
	EntityLot,
	MediaLot,
	MediaSource,
	MergeMetadataDocument,
	type MetadataProgressUpdateChange,
	SeenState,
	UpdateSeenItemDocument,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import {
	formatQuantityWithCompactNotation,
	getActionIntent,
	humanizeDuration,
	parseParameters,
	parseSearchQuery,
	processSubmission,
} from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconBulb,
	IconInfoCircle,
	IconMessageCircle2,
	IconMovie,
	IconPlayerPlay,
	IconRotateClockwise,
	IconStarFilled,
	IconUser,
	IconVideo,
} from "@tabler/icons-react";
import {
	type ReactNode,
	forwardRef,
	useCallback,
	useRef,
	useState,
} from "react";
import { Form, Link, data, useLoaderData } from "react-router";
import { Virtuoso, VirtuosoGrid, type VirtuosoHandle } from "react-virtuoso";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import {
	DisplayCollectionToEntity,
	EditButton,
	SkeletonLoader,
} from "~/components/common";
import { MediaDetailsLayout } from "~/components/common/layout";
import {
	DisplayThreePointReview,
	ReviewItemDisplay,
} from "~/components/common/review";
import {
	MediaScrollArea,
	PartialMetadataDisplay,
} from "~/components/media/base-display";
import {
	MarkEntityAsPartialMenuItem,
	ToggleMediaMonitorMenuItem,
} from "~/components/media/menu-items";
import {
	JUST_WATCH_URL,
	METADATA_LOTS_WITH_GRANULAR_UPDATES,
} from "~/components/routes/media-item/constants";
import { GenreItem } from "~/components/routes/media-item/displays/genre-item";
import { HistoryItem } from "~/components/routes/media-item/displays/history-item";
import { MetadataCreatorDisplay } from "~/components/routes/media-item/displays/metadata-creator";
import { DisplayPodcastEpisode } from "~/components/routes/media-item/displays/podcast-episode";
import { DisplayShowSeason } from "~/components/routes/media-item/displays/show-season";
import { VideoGameSpecificsDisplay } from "~/components/routes/media-item/displays/video-game-specifics";
import { VideoIframe } from "~/components/routes/media-item/displays/video-iframe";
import { MergeMetadataModal } from "~/components/routes/media-item/modals/merge-metadata-modal";
import { DisplayShowSeasonEpisodesModal } from "~/components/routes/media-item/modals/show-season-episodes-modal";
import { MEDIA_DETAILS_HEIGHT, reviewYellow } from "~/lib/shared/constants";
import { convertTimestampToUtcString, dayjsLib } from "~/lib/shared/date-utils";
import {
	useConfirmSubmit,
	useDeployBulkMetadataProgressUpdateMutation,
	useMetadataDetails,
	useMetadataGroupDetails,
	useUserMetadataDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import {
	convertRatingToUserScale,
	formatRatingForDisplay,
	getRatingUnitSuffix,
	getVerb,
} from "~/lib/shared/media-utils";
import {
	getProviderSourceImage,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import { zodDateTimeString } from "~/lib/shared/validation";
import {
	useAddEntityToCollections,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import { Verb } from "~/lib/types";
import {
	MetadataIdSchema,
	createToastHeaders,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.media.item.$id._index";

const searchParamsSchema = z.object({ defaultTab: z.string().optional() });

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { id: metadataId } = parseParameters(
		params,
		z.object({ id: z.string() }),
	);
	const query = parseSearchQuery(request, searchParamsSchema);
	return { query, metadataId };
};

export const meta = () => {
	return [{ title: "Media Item Details | Ryot" }];
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
			return data({ status: "success", tt: new Date() } as const, {
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
			return data({ status: "success", tt: new Date() } as const, {
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
	manualTimeSpent: z.string().optional(),
	startedOn: zodDateTimeString.optional(),
	finishedOn: zodDateTimeString.optional(),
	providersConsumedOn: z.array(z.string()).optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const submit = useConfirmSubmit();

	const [metadataDetails, isMetadataPartialStatusActive, metadataTranslations] =
		useMetadataDetails(loaderData.metadataId);
	const userMetadataDetails = useUserMetadataDetails(loaderData.metadataId);
	const averageRatingValue = convertRatingToUserScale(
		userMetadataDetails.data?.averageRating,
		userPreferences.general.reviewScale,
	);
	const averageRatingDisplay =
		averageRatingValue == null
			? null
			: formatRatingForDisplay(
					averageRatingValue,
					userPreferences.general.reviewScale,
				);
	const averageRatingSuffix = getRatingUnitSuffix(
		userPreferences.general.reviewScale,
	);

	const [tab, setTab] = useState<string | null>(
		loaderData.query.defaultTab || "overview",
	);
	const podcastVirtuosoRef = useRef<VirtuosoHandle>(null);
	const reviewsVirtuosoRef = useRef<VirtuosoHandle>(null);
	const [
		mergeMetadataModalOpened,
		{ open: mergeMetadataModalOpen, close: mergeMetadataModalClose },
	] = useDisclosure(false);
	const { initializeMetadataToUpdate } = useMetadataProgressUpdate();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();
	const [openedShowSeason, setOpenedShowSeason] = useState<number>();
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const deployBulkMetadataProgressUpdate =
		useDeployBulkMetadataProgressUpdateMutation(metadataDetails.data?.title);

	const changeProgress = useCallback(
		(change: MetadataProgressUpdateChange) =>
			deployBulkMetadataProgressUpdate.mutate([
				{ change, metadataId: loaderData.metadataId },
			]),
		[deployBulkMetadataProgressUpdate.mutate, loaderData.metadataId],
	);

	const changeProgressState = useCallback(
		(state: SeenState) => changeProgress({ changeLatestState: state }),
		[changeProgress],
	);

	const title =
		metadataTranslations?.title || metadataDetails.data?.title || "";
	const description =
		metadataTranslations?.description || metadataDetails.data?.description;
	const nextEntry = userMetadataDetails.data?.nextEntry;
	const inProgress = userMetadataDetails.data?.inProgress;
	const firstGroupAssociated = metadataDetails.data?.groups.at(0);
	const videos = [...(metadataDetails.data?.assets.remoteVideos || [])];
	const [{ data: metadataGroupDetails }] = useMetadataGroupDetails(
		firstGroupAssociated?.id,
		userPreferences.featuresEnabled.media.groups && !!firstGroupAssociated?.id,
	);
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
					{metadataGroupDetails?.details.title || "Group"} #
					{firstGroupAssociated.part}
				</Text>
			</Link>
		),
		metadataDetails.data?.publishDate
			? dayjsLib(metadataDetails.data.publishDate).format("LL")
			: metadataDetails.data?.publishYear,
		metadataDetails.data?.originalLanguage,
		metadataDetails.data?.productionStatus,
		metadataDetails.data?.bookSpecifics?.pages &&
			`${metadataDetails.data.bookSpecifics.pages} pages`,
		metadataDetails.data?.bookSpecifics?.isCompilation && "Compilation",
		metadataDetails.data?.podcastSpecifics?.totalEpisodes &&
			`${metadataDetails.data.podcastSpecifics.totalEpisodes} episodes`,
		metadataDetails.data?.animeSpecifics?.episodes &&
			`${metadataDetails.data.animeSpecifics.episodes} episodes`,
		metadataDetails.data?.mangaSpecifics?.chapters &&
			`${metadataDetails.data.mangaSpecifics.chapters} chapters`,
		metadataDetails.data?.mangaSpecifics?.volumes &&
			`${metadataDetails.data.mangaSpecifics.volumes} volumes`,
		metadataDetails.data?.movieSpecifics?.runtime &&
			humanizeDuration(
				dayjsLib
					.duration(metadataDetails.data.movieSpecifics.runtime, "minute")
					.asMilliseconds(),
			),
		metadataDetails.data?.showSpecifics?.totalSeasons &&
			`${metadataDetails.data.showSpecifics.totalSeasons} seasons`,
		metadataDetails.data?.showSpecifics?.totalEpisodes &&
			`${metadataDetails.data.showSpecifics.totalEpisodes} episodes`,
		metadataDetails.data?.showSpecifics?.runtime &&
			humanizeDuration(
				dayjsLib
					.duration(metadataDetails.data.showSpecifics.runtime, "minute")
					.asMilliseconds(),
			),
		metadataDetails.data?.audioBookSpecifics?.runtime &&
			humanizeDuration(
				dayjsLib
					.duration(metadataDetails.data.audioBookSpecifics.runtime, "minute")
					.asMilliseconds(),
			),
		metadataDetails.data?.musicSpecifics?.duration &&
			humanizeDuration(
				dayjsLib
					.duration(metadataDetails.data.musicSpecifics.duration, "second")
					.asMilliseconds(),
			),
		metadataDetails.data?.musicSpecifics?.viewCount &&
			formatQuantityWithCompactNotation(
				metadataDetails.data.musicSpecifics.viewCount,
			),
		metadataDetails.data?.musicSpecifics?.byVariousArtists && "Various Artists",
		metadataDetails.data?.musicSpecifics?.trackNumber &&
			`Track #${metadataDetails.data.musicSpecifics.trackNumber}`,
		metadataDetails.data?.musicSpecifics?.discNumber &&
			`Disc #${metadataDetails.data.musicSpecifics.discNumber}`,
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
		<Container>
			{metadataDetails.data && userMetadataDetails.data ? (
				<>
					<DisplayShowSeasonEpisodesModal
						openedShowSeason={openedShowSeason}
						metadataDetails={metadataDetails.data}
						setOpenedShowSeason={setOpenedShowSeason}
						userMetadataDetails={userMetadataDetails.data}
					/>
					<MediaDetailsLayout
						title={title}
						assets={metadataDetails.data.assets}
						isPartialStatusActive={isMetadataPartialStatusActive}
						externalLink={{
							lot: metadataDetails.data.lot,
							source: metadataDetails.data.source,
							href: metadataDetails.data.sourceUrl,
						}}
					>
						{userMetadataDetails.data.collections.length > 0 ? (
							<Group>
								{userMetadataDetails.data.collections.map((col) => (
									<DisplayCollectionToEntity
										col={col}
										key={col.id}
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
						{metadataDetails.data.providerRating ||
						averageRatingValue != null ? (
							<Group>
								{metadataDetails.data.providerRating ? (
									<Paper
										p={4}
										display="flex"
										style={{
											gap: 6,
											alignItems: "center",
											flexDirection: "column",
										}}
									>
										<Image
											h={24}
											w={24}
											alt="Logo"
											fit="contain"
											src={`/provider-logos/${getProviderSourceImage(metadataDetails.data.source)}`}
										/>
										<Text fz="sm">
											{Number(metadataDetails.data.providerRating).toFixed(1)}
											{match(metadataDetails.data.source)
												.with(
													MediaSource.Igdb,
													MediaSource.Tmdb,
													MediaSource.Vndb,
													MediaSource.Anilist,
													MediaSource.Listennotes,
													MediaSource.Spotify,
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
													MediaSource.Tvdb,
													MediaSource.Openlibrary,
													MediaSource.YoutubeMusic,
													MediaSource.GiantBomb,
													() => undefined,
												)
												.exhaustive()}
										</Text>
									</Paper>
								) : null}
								{averageRatingValue != null
									? match(userPreferences.general.reviewScale)
											.with(UserReviewScale.ThreePointSmiley, () => (
												<DisplayThreePointReview
													size={40}
													rating={averageRatingValue}
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
														{averageRatingDisplay}
														{averageRatingSuffix}
													</Text>
												</Paper>
											))
									: null}
							</Group>
						) : null}
						{inProgress ? (
							<Alert icon={<IconAlertCircle />} variant="outline">
								You are currently {getVerb(Verb.Read, metadataDetails.data.lot)}
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
									className={
										OnboardingTourStepTargets.MetadataDetailsActionsTab
									}
								>
									Actions
								</Tabs.Tab>
								<Tabs.Tab
									value="history"
									leftSection={<IconRotateClockwise size={16} />}
								>
									History
								</Tabs.Tab>
								{metadataDetails.data.lot === MediaLot.Show ? (
									<Tabs.Tab
										value="showSeasons"
										leftSection={<IconPlayerPlay size={16} />}
									>
										Seasons
									</Tabs.Tab>
								) : null}
								{metadataDetails.data.lot === MediaLot.Podcast ? (
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
									<Tabs.Tab
										value="videos"
										leftSection={<IconVideo size={16} />}
									>
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
										{userPreferences.featuresEnabled.media.genres &&
										metadataDetails.data.genres.length > 0 ? (
											<SimpleGrid
												cols={{ base: 3, xl: 4 }}
												spacing={{ base: "md", lg: "xs" }}
											>
												{metadataDetails.data.genres.slice(0, 12).map((g) => (
													<GenreItem key={g.id} genre={g} />
												))}
											</SimpleGrid>
										) : null}
										<VideoGameSpecificsDisplay
											specifics={metadataDetails.data.videoGameSpecifics}
										/>
										{description ? (
											<ScrollArea maw="600">
												<div
													// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
													dangerouslySetInnerHTML={{ __html: description }}
												/>
											</ScrollArea>
										) : null}
										{userPreferences.featuresEnabled.media.people ? (
											<Stack>
												{metadataDetails.data.creators.map((c) => (
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
																	<MetadataCreatorDisplay
																		data={creator}
																		key={creator.idOrName}
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
												{metadataDetails.data.lot === MediaLot.Show ? (
													<>
														<Menu.Label>Shows</Menu.Label>
														{nextEntry ? (
															<>
																<Menu.Item
																	onClick={() => {
																		initializeMetadataToUpdate({
																			metadataId: loaderData.metadataId,
																			showSeasonNumber:
																				nextEntry.season || undefined,
																			showEpisodeNumber:
																				nextEntry.episode || undefined,
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
														{userMetadataDetails.data.history.length !== 0 ? (
															<DropMenuItem />
														) : (
															<Menu.Item disabled>
																No history. Update from the seasons tab.
															</Menu.Item>
														)}
													</>
												) : null}
												{metadataDetails.data.lot === MediaLot.Anime ? (
													<>
														<Menu.Label>Anime</Menu.Label>
														<Menu.Item
															onClick={() => {
																initializeMetadataToUpdate({
																	metadataId: loaderData.metadataId,
																	animeEpisodeNumber: nextEntry?.episode || 1,
																});
															}}
														>
															Mark EP-
															{nextEntry?.episode || 1} as watched
														</Menu.Item>
														{nextEntry ? <PutOnHoldMenuItem /> : null}
														{userMetadataDetails.data.history.length !== 0 ? (
															<DropMenuItem />
														) : null}
													</>
												) : null}
												{metadataDetails.data.lot === MediaLot.Manga ? (
													<>
														<Menu.Label>Manga</Menu.Label>
														<Menu.Item
															onClick={() => {
																initializeMetadataToUpdate({
																	metadataId: loaderData.metadataId,
																	mangaVolumeNumber:
																		nextEntry?.volume || undefined,
																	mangaChapterNumber:
																		nextEntry?.chapter || undefined,
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
														{userMetadataDetails.data.history.length !== 0 ? (
															<DropMenuItem />
														) : null}
													</>
												) : null}
												{metadataDetails.data.lot === MediaLot.Podcast ? (
													<>
														<Menu.Label>Podcasts</Menu.Label>
														{nextEntry ? (
															<>
																<Menu.Item
																	onClick={() => {
																		initializeMetadataToUpdate({
																			metadataId: loaderData.metadataId,
																			podcastEpisodeNumber:
																				nextEntry.episode || undefined,
																		});
																	}}
																>
																	Mark EP-
																	{nextEntry.episode} as listened
																</Menu.Item>
																<PutOnHoldMenuItem />
															</>
														) : null}
														{userMetadataDetails.data.history.length !== 0 ? (
															<DropMenuItem />
														) : (
															<Menu.Item disabled>
																No history. Update from the episodes tab.
															</Menu.Item>
														)}
													</>
												) : null}
												{userMetadataDetails.data.inProgress ? (
													<>
														<Menu.Label>In progress</Menu.Label>
														<Menu.Item
															onClick={() => {
																initializeMetadataToUpdate({
																	metadataId: loaderData.metadataId,
																});
															}}
														>
															Set progress
														</Menu.Item>
														{!METADATA_LOTS_WITH_GRANULAR_UPDATES.includes(
															metadataDetails.data.lot,
														) ? (
															<StateChangeButtons />
														) : null}
														<Menu.Item
															onClick={() =>
																changeProgress({
																	changeLatestInProgress: "100",
																})
															}
														>
															I finished it
														</Menu.Item>
													</>
												) : !METADATA_LOTS_WITH_GRANULAR_UPDATES.includes(
														metadataDetails.data.lot,
													) ? (
													<>
														<Menu.Label>Not in progress</Menu.Label>
														{![MediaLot.Anime, MediaLot.Manga].includes(
															metadataDetails.data.lot,
														) ? (
															<Menu.Item
																onClick={() =>
																	changeProgress({
																		createNewInProgress: {
																			startedOn: convertTimestampToUtcString(
																				new Date(),
																			),
																		},
																	})
																}
															>
																I'm{" "}
																{getVerb(Verb.Read, metadataDetails.data.lot)}
																ing it
															</Menu.Item>
														) : null}
														<Menu.Item
															onClick={() => {
																initializeMetadataToUpdate({
																	metadataId: loaderData.metadataId,
																});
															}}
														>
															Add to{" "}
															{getVerb(Verb.Read, metadataDetails.data.lot)}{" "}
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
														entityLot: EntityLot.Metadata,
														entityId: loaderData.metadataId,
														metadataLot: metadataDetails.data.lot,
														entityTitle: metadataDetails.data.title,
														existingReview: {
															showExtraInformation: {
																episode:
																	userMetadataDetails.data.nextEntry?.episode ||
																	undefined,
																season:
																	userMetadataDetails.data.nextEntry?.season ||
																	undefined,
															},
															podcastExtraInformation: {
																episode:
																	userMetadataDetails.data.nextEntry?.episode ||
																	undefined,
															},
															mangaExtraInformation: {
																chapter:
																	userMetadataDetails.data.nextEntry?.chapter ||
																	undefined,
															},
															animeExtraInformation: {
																episode:
																	userMetadataDetails.data.nextEntry?.episode ||
																	undefined,
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
													entityLot: EntityLot.Metadata,
													entityId: loaderData.metadataId,
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
													entityLot={EntityLot.Metadata}
													formValue={loaderData.metadataId}
													inCollections={userMetadataDetails.data.collections.map(
														(c) => c.details.collectionName,
													)}
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
										{metadataDetails.data && (
											<EditButton
												editRouteType="media"
												label="Edit metadata"
												entityId={metadataDetails.data.id}
												source={metadataDetails.data.source}
												createdByUserId={metadataDetails.data.createdByUserId}
											/>
										)}
									</SimpleGrid>
								</MediaScrollArea>
							</Tabs.Panel>
							<Tabs.Panel value="history">
								{userMetadataDetails.data.seenByAllCount > 0 ||
								userMetadataDetails.data.seenByUserCount > 0 ? (
									<Stack h={MEDIA_DETAILS_HEIGHT} gap="xs">
										<Box>
											<Text fz={{ base: "sm", md: "md" }}>
												Seen by all users{" "}
												{userMetadataDetails.data.seenByAllCount} time
												{userMetadataDetails.data.seenByAllCount > 1 ? "s" : ""}{" "}
												and {userMetadataDetails.data.seenByUserCount} time
												{userMetadataDetails.data &&
												userMetadataDetails.data.seenByUserCount > 1
													? "s"
													: ""}{" "}
												by you.
											</Text>
										</Box>
										<Virtuoso
											data={userMetadataDetails.data.history}
											itemContent={(index, history) => (
												<HistoryItem
													index={index}
													setTab={setTab}
													key={history.id}
													history={history}
													reviewsVirtuosoRef={reviewsVirtuosoRef}
													podcastVirtuosoRef={podcastVirtuosoRef}
													metadataDetails={metadataDetails.data}
													userMetadataDetails={userMetadataDetails.data}
												/>
											)}
										/>
									</Stack>
								) : (
									<Text>No history</Text>
								)}
							</Tabs.Panel>
							<Tabs.Panel value="showSeasons" h={MEDIA_DETAILS_HEIGHT}>
								{metadataDetails.data.showSpecifics ? (
									<Virtuoso
										data={metadataDetails.data.showSpecifics.seasons}
										itemContent={(seasonIdx, season) => (
											<DisplayShowSeason
												season={season}
												seasonIdx={seasonIdx}
												key={season.seasonNumber}
												metadataId={loaderData.metadataId}
												userMetadataDetails={userMetadataDetails.data}
												openSeasonModal={() => setOpenedShowSeason(seasonIdx)}
											/>
										)}
									/>
								) : null}
							</Tabs.Panel>
							{metadataDetails.data.podcastSpecifics ? (
								<Tabs.Panel value="podcastEpisodes" h={MEDIA_DETAILS_HEIGHT}>
									<Virtuoso
										ref={podcastVirtuosoRef}
										data={metadataDetails.data.podcastSpecifics.episodes}
										itemContent={(podcastEpisodeIdx, podcastEpisode) => (
											<DisplayPodcastEpisode
												key={podcastEpisode.id}
												episode={podcastEpisode}
												index={podcastEpisodeIdx}
												podcastProgress={
													userMetadataDetails.data.podcastProgress
												}
												metadataDetails={metadataDetails.data}
											/>
										)}
									/>
								</Tabs.Panel>
							) : null}
							{!userPreferences.general.disableReviews ? (
								<Tabs.Panel value="reviews" h={MEDIA_DETAILS_HEIGHT}>
									{userMetadataDetails.data.reviews.length > 0 ? (
										<Virtuoso
											ref={reviewsVirtuosoRef}
											data={userMetadataDetails.data.reviews}
											itemContent={(_review, r) => (
												<ReviewItemDisplay
													key={r.id}
													review={r}
													lot={metadataDetails.data.lot}
													entityLot={EntityLot.Metadata}
													entityId={loaderData.metadataId}
													title={metadataDetails.data.title}
												/>
											)}
										/>
									) : (
										<Text>No reviews</Text>
									)}
								</Tabs.Panel>
							) : null}
							<Tabs.Panel value="suggestions" h={MEDIA_DETAILS_HEIGHT}>
								{metadataDetails.data.suggestions.length > 0 ? (
									<VirtuosoGrid
										totalCount={metadataDetails.data.suggestions.length}
										itemContent={(index) => (
											<PartialMetadataDisplay
												metadataId={metadataDetails.data.suggestions[index]}
											/>
										)}
										components={{
											List: forwardRef((props, ref) => (
												<SimpleGrid
													ref={ref}
													{...props}
													cols={{ base: 3, md: 4, lg: 5 }}
												/>
											)),
										}}
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
									{metadataDetails.data.watchProviders.length > 0 ? (
										<MediaScrollArea>
											<Stack gap="sm">
												<Text>
													JustWatch makes it easy to find out where you can
													legally watch your favorite movies & TV shows online.
													Visit{" "}
													<Anchor
														target="_blank"
														href={JUST_WATCH_URL}
														rel="noopener noreferrer"
													>
														JustWatch
													</Anchor>{" "}
													for more information.
												</Text>
												<Text>
													The following is a list of all available watch
													providers for this media along with the countries they
													are available in.
												</Text>
												{metadataDetails.data.watchProviders.map((provider) => (
													<Flex key={provider.name} align="center" gap="md">
														<Image
															h={80}
															w={80}
															radius="md"
															src={provider.image}
														/>
														<Text lineClamp={3}>
															{provider.name}:{" "}
															<Text size="xs" span>
																{provider.languages.join(", ")}
															</Text>
														</Text>
													</Flex>
												))}
											</Stack>
										</MediaScrollArea>
									) : (
										<Text>No watch providers</Text>
									)}
								</Tabs.Panel>
							) : null}
						</Tabs>
					</MediaDetailsLayout>
				</>
			) : (
				<SkeletonLoader />
			)}
		</Container>
	);
}
