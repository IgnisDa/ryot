import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	Accordion,
	ActionIcon,
	Alert,
	Anchor,
	Avatar,
	Box,
	Button,
	Container,
	Divider,
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
	Slider,
	Stack,
	Tabs,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDidUpdate, useDisclosure, useInViewport } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	Link,
	type MetaArgs_SingleFetch,
	useLoaderData,
} from "@remix-run/react";
import {
	DeleteSeenItemDocument,
	DisassociateMetadataDocument,
	EntityLot,
	MediaLot,
	MediaSource,
	MergeMetadataDocument,
	MetadataDetailsDocument,
	type MetadataDetailsQuery,
	MetadataVideoSource,
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
	humanizeDuration,
	isInteger,
	isNumber,
	isString,
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
	useRef,
	useState,
} from "react";
import { Virtuoso, VirtuosoGrid, type VirtuosoHandle } from "react-virtuoso";
import { $path } from "remix-routes";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import {
	DisplayCollection,
	DisplayThreePointReview,
	MEDIA_DETAILS_HEIGHT,
	MediaDetailsLayout,
	ProRequiredAlert,
	ReviewItemDisplay,
} from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import {
	MediaScrollArea,
	PartialMetadataDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import { Verb, dayjsLib, getVerb, reviewYellow } from "~/lib/generals";
import {
	useApplicationEvents,
	useConfirmSubmit,
	useCoreDetails,
	useGetMantineColor,
	useUserDetails,
	useUserPreferences,
} from "~/lib/hooks";
import {
	useAddEntityToCollection,
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

const JUST_WATCH_URL = "https://www.justwatch.com";

const searchParamsSchema = z
	.object({ defaultTab: z.string().optional() })
	.merge(MetadataSpecificsSchema);

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const { id: metadataId } = zx.parseParams(params, { id: z.string() });
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ metadataDetails }, { userMetadataDetails }] = await Promise.all([
		serverGqlService.request(MetadataDetailsDocument, { metadataId }),
		serverGqlService.authenticatedRequest(
			request,
			UserMetadataDetailsDocument,
			{ metadataId },
		),
	]);
	return { query, metadataId, metadataDetails, userMetadataDetails };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.metadataDetails.title} | Ryot` }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		deleteSeenItem: async () => {
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
		},
		mergeMetadata: async () => {
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
		},
		editSeenItem: async () => {
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
		},
		removeItem: async () => {
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
		},
	});
});

const seenIdSchema = z.object({ seenId: z.string() });

const mergeMetadataSchema = z.object({
	mergeFrom: z.string(),
	mergeInto: z.string(),
});

const dateString = z
	.string()
	.transform((v) => formatDateToNaiveDate(new Date(v)));

const editSeenItem = z.object({
	seenId: z.string(),
	reviewId: z.string().optional(),
	startedOn: dateString.optional(),
	finishedOn: dateString.optional(),
	manualTimeSpent: z.string().optional(),
	providerWatchedOn: z.string().optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const events = useApplicationEvents();
	const getMantineColor = useGetMantineColor();
	const submit = useConfirmSubmit();
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
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();
	const nextEntry = loaderData.userMetadataDetails.nextEntry;

	const PutOnHoldBtn = () => {
		return (
			<Form
				action={withQuery($path("/actions"), {
					intent: "individualProgressUpdate",
				})}
				method="POST"
				replace
				onSubmit={(e) => {
					submit(e);
					events.updateProgress(loaderData.metadataDetails.title);
				}}
			>
				<input hidden name="metadataId" defaultValue={loaderData.metadataId} />
				<input hidden name="changeState" defaultValue={SeenState.OnAHold} />
				<Menu.Item type="submit">Put on hold</Menu.Item>
			</Form>
		);
	};
	const DropBtn = () => {
		return (
			<Form
				action={withQuery($path("/actions"), {
					intent: "individualProgressUpdate",
				})}
				method="POST"
				replace
				onSubmit={(e) => {
					submit(e);
					events.updateProgress(loaderData.metadataDetails.title);
				}}
			>
				<input hidden name="metadataId" defaultValue={loaderData.metadataId} />
				<input hidden name="changeState" defaultValue={SeenState.Dropped} />
				<Menu.Item type="submit">Mark as dropped</Menu.Item>
			</Form>
		);
	};
	const StateChangeButtons = () => {
		return (
			<>
				<PutOnHoldBtn />
				<DropBtn />
			</>
		);
	};

	return (
		<Container>
			<MediaDetailsLayout
				images={loaderData.metadataDetails.assets.images}
				entityDetails={{
					id: loaderData.metadataId,
					lot: EntityLot.Metadata,
					isPartial: loaderData.metadataDetails.isPartial,
				}}
				externalLink={{
					source: loaderData.metadataDetails.source,
					lot: loaderData.metadataDetails.lot,
					href: loaderData.metadataDetails.sourceUrl,
				}}
			>
				<Box>
					{userPreferences.featuresEnabled.media.groups &&
					loaderData.metadataDetails.group ? (
						<Link
							to={$path("/media/groups/item/:id", {
								id: loaderData.metadataDetails.group.id,
							})}
							style={{ color: "unset" }}
						>
							<Text c="dimmed" fs="italic">
								{loaderData.metadataDetails.group.name} #
								{loaderData.metadataDetails.group.part}
							</Text>
						</Link>
					) : null}
					<Title id="media-title">{loaderData.metadataDetails.title}</Title>
				</Box>
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
				<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
					{[
						loaderData.metadataDetails.publishDate
							? dayjsLib(loaderData.metadataDetails.publishDate).format("LL")
							: loaderData.metadataDetails.publishYear,
						loaderData.metadataDetails.originalLanguage,
						loaderData.metadataDetails.productionStatus,
						loaderData.metadataDetails.bookSpecifics?.pages &&
							`${loaderData.metadataDetails.bookSpecifics.pages} pages`,
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
									.duration(
										loaderData.metadataDetails.movieSpecifics.runtime,
										"minute",
									)
									.asMilliseconds(),
							),
						loaderData.metadataDetails.showSpecifics?.totalSeasons &&
							`${loaderData.metadataDetails.showSpecifics.totalSeasons} seasons`,
						loaderData.metadataDetails.showSpecifics?.totalEpisodes &&
							`${loaderData.metadataDetails.showSpecifics.totalEpisodes} episodes`,
						loaderData.metadataDetails.showSpecifics?.runtime &&
							humanizeDuration(
								dayjsLib
									.duration(
										loaderData.metadataDetails.showSpecifics.runtime,
										"minute",
									)
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
					]
						.filter(Boolean)
						.join(" • ")}
				</Text>
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
										.with(MediaSource.Mal, () => "mal.svg")
										.with(MediaSource.MangaUpdates, () => "manga-updates.svg")
										.with(MediaSource.Openlibrary, () => "openlibrary.svg")
										.with(MediaSource.Tmdb, () => "tmdb.svg")
										.with(MediaSource.Vndb, () => "vndb.ico")
										.with(MediaSource.Custom, () => undefined)
										.exhaustive()}`}
								/>
								<Text fz="sm">
									{Number(loaderData.metadataDetails.providerRating).toFixed(1)}
									{match(loaderData.metadataDetails.source)
										.with(
											MediaSource.Anilist,
											MediaSource.Igdb,
											MediaSource.Listennotes,
											MediaSource.Tmdb,
											MediaSource.Vndb,
											() => "%",
										)
										.with(
											MediaSource.Audible,
											MediaSource.GoogleBooks,
											() => "/5",
										)
										.with(
											MediaSource.Mal,
											MediaSource.MangaUpdates,
											() => "/10",
										)
										.with(
											MediaSource.Custom,
											MediaSource.Itunes,
											MediaSource.Openlibrary,
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
											rating={loaderData.userMetadataDetails.averageRating}
											size={40}
										/>
									))
									.otherwise(() => (
										<Paper
											p={4}
											display="flex"
											style={{
												flexDirection: "column",
												alignItems: "center",
												gap: 6,
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
												UserReviewScale.OutOfFive
													? undefined
													: "%"}
											</Text>
										</Paper>
									))
							: null}
					</Group>
				) : null}
				{loaderData.userMetadataDetails?.inProgress ? (
					<Alert icon={<IconAlertCircle />} variant="outline">
						You are currently{" "}
						{getVerb(Verb.Read, loaderData.metadataDetails.lot)}
						ing this (
						{Number(loaderData.userMetadataDetails.inProgress.progress).toFixed(
							2,
						)}
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
						<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
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
						<Tabs.Tab value="suggestions" leftSection={<IconBulb size={16} />}>
							Suggestions
						</Tabs.Tab>
						{!userPreferences.general.disableVideos &&
						(loaderData.metadataDetails.assets.videos.length || 0) > 0 ? (
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
												.map((g) => (
													<Group key={g.id} wrap="nowrap">
														<Box
															h={11}
															w={11}
															style={{ borderRadius: 2, flex: "none" }}
															bg={getMantineColor(g.name)}
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
												))
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
															<Box key={`${creator.id}-${creator.name}`}>
																{creator.id ? (
																	<Anchor
																		component={Link}
																		data-creator-id={creator.id}
																		to={$path("/media/people/item/:id", {
																			id: creator.id,
																		})}
																	>
																		<MetadataCreator
																			name={creator.name}
																			image={creator.image}
																			character={creator.character}
																		/>
																	</Anchor>
																) : (
																	<MetadataCreator
																		name={creator.name}
																		image={creator.image}
																		character={creator.character}
																	/>
																)}
															</Box>
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
															{`S${nextEntry.season}-E${nextEntry.episode}`} as
															seen
														</Menu.Item>
														<PutOnHoldBtn />
													</>
												) : null}
												{loaderData.userMetadataDetails.history.length !== 0 ? (
													<DropBtn />
												) : (
													<Menu.Item disabled>
														No history. Update from the seasons tab.
													</Menu.Item>
												)}
											</>
										) : null}
										{loaderData.metadataDetails.lot === MediaLot.Anime &&
										nextEntry ? (
											<>
												<Menu.Label>Anime</Menu.Label>
												<>
													<Menu.Item
														onClick={() => {
															setMetadataToUpdate({
																metadataId: loaderData.metadataId,
																animeEpisodeNumber: nextEntry.episode,
															});
														}}
													>
														Mark EP-
														{nextEntry.episode} as listened
													</Menu.Item>
												</>
											</>
										) : null}
										{loaderData.metadataDetails.lot === MediaLot.Manga &&
										nextEntry ? (
											<>
												<Menu.Label>Manga</Menu.Label>
												<>
													<Menu.Item
														onClick={() => {
															setMetadataToUpdate({
																metadataId: loaderData.metadataId,
																mangaChapterNumber: nextEntry.chapter,
																mangaVolumeNumber: nextEntry.volume,
															});
														}}
													>
														Mark{" "}
														{nextEntry.chapter
															? `CH-${nextEntry.chapter}`
															: `VOL-${nextEntry.volume}`}{" "}
														as read
													</Menu.Item>
												</>
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
														<PutOnHoldBtn />
													</>
												) : null}
												{loaderData.userMetadataDetails.history.length !== 0 ? (
													<DropBtn />
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
												{loaderData.metadataDetails.lot !== MediaLot.Show &&
												loaderData.metadataDetails.lot !== MediaLot.Podcast ? (
													<StateChangeButtons />
												) : null}
												<Form
													action={withQuery($path("/actions"), {
														intent: "individualProgressUpdate",
													})}
													method="POST"
													replace
													onSubmit={(e) => {
														submit(e);
														events.updateProgress(
															loaderData.metadataDetails.title,
														);
													}}
												>
													<input hidden name="progress" defaultValue={100} />
													<input
														hidden
														name="date"
														defaultValue={formatDateToNaiveDate(new Date())}
													/>
													<input
														hidden
														name="metadataId"
														defaultValue={loaderData.metadataId}
													/>
													<Menu.Item type="submit">I finished it</Menu.Item>
												</Form>
											</>
										) : loaderData.metadataDetails.lot !== MediaLot.Show &&
											loaderData.metadataDetails.lot !== MediaLot.Podcast ? (
											<>
												<Menu.Label>Not in progress</Menu.Label>
												<Form
													action={withQuery($path("/actions"), {
														intent: "individualProgressUpdate",
													})}
													method="POST"
													replace
													onSubmit={(e) => {
														submit(e);
														events.updateProgress(
															loaderData.metadataDetails.title,
														);
													}}
												>
													<input hidden name="progress" defaultValue={0} />
													<input
														hidden
														name="metadataId"
														defaultValue={loaderData.metadataId}
													/>
													{![MediaLot.Anime, MediaLot.Manga].includes(
														loaderData.metadataDetails.lot,
													) ? (
														<Menu.Item type="submit">
															I'm{" "}
															{getVerb(
																Verb.Read,
																loaderData.metadataDetails.lot,
															)}
															ing it
														</Menu.Item>
													) : null}
												</Form>
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
										setAddEntityToCollectionData({
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
											action={withQuery("", { intent: "removeItem" })}
										>
											<input
												hidden
												name="metadataId"
												defaultValue={loaderData.metadataId}
											/>
											<Menu.Item
												color="red"
												onClick={async (e) => {
													const form = e.currentTarget.form;
													if (form) {
														e.preventDefault();
														const conf = await confirmWrapper({
															confirmation:
																"Are you sure you want to remove this item? This will remove it from all collections and delete all history and reviews.",
														});
														if (conf && form) submit(form);
													}
												}}
											>
												Remove item
											</Menu.Item>
										</Form>
									</Menu.Dropdown>
								</Menu>
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
					<Tabs.Panel value="showSeasons">
						<MediaScrollArea>
							{loaderData.metadataDetails.showSpecifics &&
							loaderData.userMetadataDetails.showProgress ? (
								<Accordion chevron={<Box />}>
									{loaderData.metadataDetails.showSpecifics.seasons.map(
										(season, seasonIdx) => {
											const seasonProgress =
												loaderData.userMetadataDetails.showProgress?.[
													seasonIdx
												];
											return (
												<Accordion.Item
													key={season.seasonNumber}
													value={season.seasonNumber.toString()}
												>
													<Accordion.Control component={Box} py={0} px="xs">
														<DisplayShowSeason
															season={season}
															seasonProgress={seasonProgress}
														/>
													</Accordion.Control>
													<Accordion.Panel>
														<Stack h={300} gap="xs">
															<Virtuoso
																data={season.episodes}
																itemContent={(episodeIdx, episode) => (
																	<DisplayShowEpisode
																		episode={episode}
																		seasonIdx={seasonIdx}
																		episodeIdx={episodeIdx}
																		episodeProgress={
																			seasonProgress?.episodes[episodeIdx]
																		}
																		seasonNumber={season.seasonNumber}
																	/>
																)}
															/>
														</Stack>
													</Accordion.Panel>
												</Accordion.Item>
											);
										},
									)}
								</Accordion>
							) : null}
						</MediaScrollArea>
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
											review={r}
											key={r.id}
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
									{loaderData.metadataDetails.assets.videos.map((v) => (
										<VideoIframe
											key={v.videoId}
											videoId={v.videoId}
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
											JustWatch makes it easy to find out where you can legally
											watch your favorite movies & TV shows online. Visit{" "}
											<Anchor href={JUST_WATCH_URL}>JustWatch</Anchor> for more
											information.
										</Text>
										<Text>
											The following is a list of all available watch providers
											for this media along with the countries they are available
											in.
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
	);
}

const VideoIframe = (props: {
	videoId: string;
	videoSource: MetadataVideoSource;
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
								MetadataVideoSource.Youtube,
								() => "https://www.youtube.com/embed/",
							)
							.with(
								MetadataVideoSource.Dailymotion,
								() => "https://www.dailymotion.com/embed/video/",
							)
							.with(MetadataVideoSource.Custom, () => "")
							.exhaustive() + props.videoId
					}
					title="Video player"
					allowFullScreen
				/>
			) : null}
		</Box>
	);
};

const MetadataCreator = (props: {
	name: string;
	image?: string | null;
	character?: string | null;
}) => {
	return (
		<>
			<Avatar
				imageProps={{ loading: "lazy" }}
				src={props.image}
				h={100}
				w={85}
				radius="sm"
				mx="auto"
				alt={`${props.name} profile picture`}
				styles={{ image: { objectPosition: "top" } }}
			/>
			<Text size="xs" c="dimmed" ta="center" lineClamp={3} mt={4}>
				{props.name}
				{props.character ? ` as ${props.character}` : null}
			</Text>
		</>
	);
};

type History =
	UserMetadataDetailsQuery["userMetadataDetails"]["history"][number];

const DEFAULT_STATES = [0, 3];

const EditHistoryRecordModal = (props: {
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
	const [mtv, mts] = manualTimeSpent
		? //  IDK how to make this more readable. Should've paid more attention in math class.
			(() => {
				for (let i = 1; i <= 10; i++) {
					const v = Number(manualTimeSpent) ** (1 / i);
					if (v <= 100) return [v, i];
				}
				return DEFAULT_STATES;
			})()
		: DEFAULT_STATES;
	const [manualTimeSpentValue, setManualTimeSpentValue] = useState(mtv);
	const [manualTimeSpentScale, setManualTimeSpentScale] = useState(mts);
	const manualTimeSpentInMinutes = manualTimeSpentValue ** manualTimeSpentScale;
	const userPreferences = useUserPreferences();
	const coreDetails = useCoreDetails();
	const isNotCompleted = props.seen.state !== SeenState.Completed;

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
				action={withQuery("", { intent: "editSeenItem" })}
			>
				<input hidden name="seenId" defaultValue={id} />
				<Stack>
					<Title order={3}>Edit history record</Title>
					<DateInput
						label="Start time"
						name="startedOn"
						defaultValue={startedOn ? new Date(startedOn) : undefined}
						disabled={isNotCompleted}
					/>
					<DateInput
						label="End time"
						name="finishedOn"
						defaultValue={finishedOn ? new Date(finishedOn) : undefined}
						disabled={isNotCompleted}
					/>
					<Input.Wrapper
						label="Time spent"
						description="How much time did you actually spend on this media? You can also adjust the scale"
					>
						<Box mt="xs">
							{coreDetails.isPro ? (
								<>
									<Group>
										<Slider
											flex={1}
											label={null}
											value={manualTimeSpentValue}
											onChange={setManualTimeSpentValue}
										/>
										<NumberInput
											w="20%"
											max={10}
											size="xs"
											value={manualTimeSpentScale}
											onChange={(v) => setManualTimeSpentScale(Number(v))}
										/>
									</Group>
									<Text c="dimmed" size="sm" ta="center" mt="xs">
										{humanizeDuration(manualTimeSpentInMinutes * 1000)}
									</Text>
									{manualTimeSpentInMinutes > 0 ? (
										<input
											hidden
											readOnly
											name="manualTimeSpent"
											value={manualTimeSpentInMinutes}
										/>
									) : null}
								</>
							) : (
								<ProRequiredAlert tooltipLabel="Track time spent on media" />
							)}
						</Box>
					</Input.Wrapper>
					<Select
						clearable
						searchable
						limit={5}
						name="reviewId"
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
					<Select
						data={userPreferences.general.watchProviders}
						label={`Where did you ${getVerb(
							Verb.Read,
							loaderData.metadataDetails.lot,
						)} it?`}
						name="providerWatchedOn"
						defaultValue={providerWatchedOn}
					/>
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
				action={withQuery("", { intent: "mergeMetadata" })}
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
		props.setTab(tab);
		if (!isNumber(index)) return;
		setTimeout(() => {
			const current = ref.current;
			current?.scrollToIndex({ index, behavior: "smooth", align: "start" });
		}, 500);
	};
	const scrollToEpisode = (index?: number) => {
		if (!coreDetails.isPro) {
			notifications.show({
				color: "red",
				message: "Ryot Pro is required to jump to episodes",
			});
			return;
		}
		scrollToVirtuosoElement(props.podcastVirtuosoRef, "podcastEpisodes", index);
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
				scrollToEpisode(
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
						action={withQuery("", { intent: "deleteSeenItem" })}
					>
						<input hidden name="seenId" defaultValue={props.history.id} />
						<ActionIcon
							color="red"
							type="submit"
							onClick={async (e) => {
								const form = e.currentTarget.form;
								e.preventDefault();
								const conf = await confirmWrapper({
									confirmation:
										"Are you sure you want to delete this record from history?",
								});
								if (conf && form) submit(form);
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
							<ActionIcon size="xs" color="blue">
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
			<EditHistoryRecordModal
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
	overview?: string | null;
	displayIndicator: number;
	id?: number | string | null;
	numEpisodes?: number | null;
	posterImages: Array<string>;
	publishDate?: string | null;
}) => {
	const [parent] = useAutoAnimate();
	const [displayOverview, setDisplayOverview] = useDisclosure(false);
	const swt = (t: string) => (
		<Text size="xs" c="dimmed">
			{t}
		</Text>
	);
	const filteredElements = [
		props.runtime
			? swt(
					humanizeDuration(
						dayjsLib.duration(props.runtime, "minutes").asMilliseconds(),
						{ units: ["h", "m"] },
					),
				)
			: null,
		props.publishDate ? swt(dayjsLib(props.publishDate).format("ll")) : null,
		props.numEpisodes ? swt(`${props.numEpisodes} episodes`) : null,
		props.overview ? (
			<Anchor key="overview" size="xs" onClick={setDisplayOverview.toggle}>
				{displayOverview ? "Hide" : "Show"} overview
			</Anchor>
		) : null,
	].filter((s) => s !== null);
	const display =
		filteredElements.length > 0
			? filteredElements
					.map<ReactNode>((s, i) => <Fragment key={i.toString()}>{s}</Fragment>)
					.reduce((prev, curr) => [prev, " • ", curr])
			: null;

	const isSeen = props.displayIndicator >= 1;

	const DisplayDetails = () => (
		<>
			<Text lineClamp={2}>{props.name}</Text>
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
						disabled={!isSeen}
						label={
							props.displayIndicator === 1
								? "Seen"
								: `Seen × ${props.displayIndicator}`
						}
						offset={7}
						position="bottom-end"
						size={16}
						color="cyan"
						style={{ zIndex: 0 }}
					>
						<Avatar
							src={props.posterImages[0]}
							name={props.name}
							radius="xl"
							size="lg"
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
			{props.overview && displayOverview ? (
				<Text
					size="sm"
					c="dimmed"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
					dangerouslySetInnerHTML={{ __html: props.overview }}
					lineClamp={5}
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

const DisplayShowSeason = (props: {
	season: Season;
	seasonProgress?: SeasonProgress;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const numTimesSeen = props.seasonProgress?.timesSeen || 0;
	const isSeen = numTimesSeen > 0;

	return (
		<DisplaySeasonOrEpisodeDetails
			{...props.season}
			name={`${props.season.seasonNumber}. ${props.season.name}`}
			numEpisodes={props.season.episodes.length}
			displayIndicator={numTimesSeen}
			runtime={props.season.episodes
				.map((e) => e.runtime || 0)
				.reduce((i, a) => i + a, 0)}
		>
			<>
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
			</>
		</DisplaySeasonOrEpisodeDetails>
	);
};

const DisplayShowEpisode = (props: {
	seasonIdx: number;
	seasonNumber: number;
	episodeIdx: number;
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
					variant={numTimesEpisodeSeen > 0 ? "default" : "outline"}
					size="xs"
					color="blue"
					onClick={() => {
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
