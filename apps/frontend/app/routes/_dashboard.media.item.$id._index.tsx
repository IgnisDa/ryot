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
	DeployUpdateMediaEntityJobDocument,
	DisassociateMetadataDocument,
	EntityLot,
	MediaLot,
	MediaSource,
	MergeMetadataDocument,
	MetadataDetailsDocument,
	type MetadataProgressUpdateChange,
	SeenState,
	UpdateSeenItemDocument,
	UserMetadataDetailsDocument,
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
import { DisplayCollectionToEntity } from "~/components/common";
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
import { HistoryItem } from "~/components/routes/media-item/displays/history-item";
import { MetadataCreator } from "~/components/routes/media-item/displays/metadata-creator";
import { DisplayPodcastEpisode } from "~/components/routes/media-item/displays/podcast-episode";
import { DisplayShowSeason } from "~/components/routes/media-item/displays/show-season";
import { VideoIframe } from "~/components/routes/media-item/displays/video-iframe";
import { MergeMetadataModal } from "~/components/routes/media-item/modals/merge-metadata-modal";
import { DisplayShowSeasonEpisodesModal } from "~/components/routes/media-item/modals/show-season-episodes-modal";
import { MEDIA_DETAILS_HEIGHT, reviewYellow } from "~/lib/shared/constants";
import { convertTimestampToUtcString, dayjsLib } from "~/lib/shared/date-utils";
import {
	useConfirmSubmit,
	useDeployBulkMetadataProgressUpdateMutation,
	useGetRandomMantineColor,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { getVerb } from "~/lib/shared/media-utils";
import { clientGqlService } from "~/lib/shared/query-factory";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { zodDateTimeString } from "~/lib/shared/validation";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import {
	useAddEntityToCollections,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";
import { Verb } from "~/lib/types";
import {
	MetadataIdSchema,
	MetadataSpecificsSchema,
	createToastHeaders,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.media.item.$id._index";

const searchParamsSchema = z
	.object({ defaultTab: z.string().optional() })
	.extend(MetadataSpecificsSchema.shape);

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
		await serverGqlService.request(DeployUpdateMediaEntityJobDocument, {
			entityId: metadataId,
			entityLot: EntityLot.Metadata,
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
	const { initializeMetadataToUpdate } = useMetadataProgressUpdate();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();
	const [openedShowSeason, setOpenedShowSeason] = useState<number>();
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const deployBulkMetadataProgressUpdate =
		useDeployBulkMetadataProgressUpdateMutation(
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
		loaderData.metadataDetails.musicSpecifics?.trackNumber &&
			`Track #${loaderData.metadataDetails.musicSpecifics.trackNumber}`,
		loaderData.metadataDetails.musicSpecifics?.discNumber &&
			`Disc #${loaderData.metadataDetails.musicSpecifics.discNumber}`,
		loaderData.metadataDetails.videoGameSpecifics?.platforms &&
			`Platforms: ${loaderData.metadataDetails.videoGameSpecifics.platforms.join(", ")}`,
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
				metadataDetails={loaderData.metadataDetails}
				userMetadataDetails={loaderData.userMetadataDetails}
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
										h={24}
										w={24}
										alt="Logo"
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
											.with(MediaSource.GiantBomb, () => "giant-bomb.jpeg")
											.with(MediaSource.Spotify, () => "spotify.svg")
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
												MediaSource.Openlibrary,
												MediaSource.YoutubeMusic,
												MediaSource.GiantBomb,
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
										<ScrollArea maw="600">
											<div
												// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
												dangerouslySetInnerHTML={{
													__html: loaderData.metadataDetails.description,
												}}
											/>
										</ScrollArea>
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
															initializeMetadataToUpdate({
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
																		startedOn: convertTimestampToUtcString(
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
															initializeMetadataToUpdate({
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
												inCollections={loaderData.userMetadataDetails.collections.map(
													(c) => c.details.collectionName,
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
												metadataDetails={loaderData.metadataDetails}
												userMetadataDetails={loaderData.userMetadataDetails}
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
											metadataId={loaderData.metadataId}
											userMetadataDetails={loaderData.userMetadataDetails}
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
											metadataDetails={loaderData.metadataDetails}
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
