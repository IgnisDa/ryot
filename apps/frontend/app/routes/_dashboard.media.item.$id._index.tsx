import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Alert,
	Anchor,
	Avatar,
	Box,
	Button,
	Container,
	Divider,
	Flex,
	Group,
	Image,
	Indicator,
	Menu,
	Modal,
	Paper,
	ScrollArea,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	Link,
	type MetaArgs_SingleFetch,
	useLoaderData,
} from "@remix-run/react";
import {
	DeleteSeenItemDocument,
	DeployUpdateMetadataJobDocument,
	EditSeenItemDocument,
	EntityLot,
	MediaLot,
	MediaSource,
	MergeMetadataDocument,
	MetadataDetailsDocument,
	MetadataVideoSource,
	type PodcastEpisode,
	SeenState,
	UserMetadataDetailsDocument,
	type UserMetadataDetailsQuery,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	formatDateToNaiveDate,
	humanizeDuration,
} from "@ryot/ts-utils";
import {
	IconAlertCircle,
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
import { type ReactNode, useState } from "react";
import { GroupedVirtuoso, Virtuoso } from "react-virtuoso";
import { namedAction } from "remix-utils/named-action";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import {
	HiddenLocationInput,
	MEDIA_DETAILS_HEIGHT,
	MediaDetailsLayout,
} from "~/components/common";
import {
	DisplayCollection,
	MediaIsPartial,
	MediaScrollArea,
	PartialMetadataDisplay,
	ReviewItemDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import events from "~/lib/events";
import { Verb, dayjsLib, getVerb, queryClient } from "~/lib/generals";
import { useGetMantineColor, useUserPreferences } from "~/lib/hooks";
import {
	useAddEntityToCollection,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";
import {
	MetadataIdSchema,
	createToastHeaders,
	getAuthorizationHeader,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";
import {
	MetadataSpecificsSchema,
	processSubmission,
} from "~/lib/utilities.server";

const JUST_WATCH_URL = "https://www.justwatch.com";

const searchParamsSchema = z
	.object({ defaultTab: z.string().optional() })
	.merge(MetadataSpecificsSchema);

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const metadataId = params.id;
	invariant(metadataId, "No ID provided");
	const [{ metadataDetails }, { userMetadataDetails }] = await Promise.all([
		serverGqlService.request(MetadataDetailsDocument, { metadataId }),
		serverGqlService.request(
			UserMetadataDetailsDocument,
			{ metadataId },
			getAuthorizationHeader(request),
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
			await serverGqlService.request(
				DeleteSeenItemDocument,
				submission,
				getAuthorizationHeader(request),
			);
			return Response.json({ status: "success", tt: new Date() } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Record deleted successfully",
				}),
			});
		},
		deployUpdateMetadataJob: async () => {
			const submission = processSubmission(formData, MetadataIdSchema);
			await serverGqlService.request(
				DeployUpdateMetadataJobDocument,
				submission,
				getAuthorizationHeader(request),
			);
			return Response.json({ status: "success", tt: new Date() } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Metadata update job deployed successfully",
				}),
			});
		},
		mergeMetadata: async () => {
			const submission = processSubmission(formData, mergeMetadataSchema);
			await serverGqlService.request(
				MergeMetadataDocument,
				submission,
				getAuthorizationHeader(request),
			);
			return redirectWithToast(
				$path("/media/item/:id", { id: submission.mergeInto }),
				{ type: "success", message: "Metadata merged successfully" },
			);
		},
		editSeenItem: async () => {
			const submission = processSubmission(formData, editSeenItem);
			await serverGqlService.request(
				EditSeenItemDocument,
				{ input: submission },
				getAuthorizationHeader(request),
			);
			return Response.json({ status: "success", tt: new Date() } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Adjusted seen item successfully",
				}),
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
	startedOn: dateString.optional(),
	finishedOn: dateString.optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const getMantineColor = useGetMantineColor();
	const [tab, setTab] = useState<string | null>(
		loaderData.query.defaultTab || "overview",
	);
	const [
		mergeMetadataModalOpened,
		{ open: mergeMetadataModalOpen, close: mergeMetadataModalClose },
	] = useDisclosure(false);
	const [_m, setMetadataToUpdate] = useMetadataProgressUpdate();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();

	const PutOnHoldBtn = () => {
		return (
			<Form
				action={withQuery($path("/actions"), {
					intent: "individualProgressUpdate",
				})}
				method="post"
				replace
				onSubmit={() => {
					events.updateProgress(loaderData.metadataDetails.title);
				}}
			>
				<HiddenLocationInput />
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
				method="post"
				replace
				onSubmit={() => {
					events.updateProgress(loaderData.metadataDetails.title);
				}}
			>
				<HiddenLocationInput />
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
				{loaderData.metadataDetails.isPartial ? (
					<MediaIsPartial mediaType="media" />
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
						{loaderData.userMetadataDetails.averageRating ? (
							<Paper
								p={4}
								display="flex"
								style={{
									flexDirection: "column",
									alignItems: "center",
									gap: 6,
								}}
							>
								<IconStarFilled size={22} style={{ color: "#EBE600FF" }} />
								<Text fz="sm">
									{Number(loaderData.userMetadataDetails.averageRating).toFixed(
										1,
									)}
									{userPreferences.general.reviewScale ===
									UserReviewScale.OutOfFive
										? undefined
										: "%"}
								</Text>
							</Paper>
						) : null}
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
												{loaderData.userMetadataDetails.nextEntry ? (
													<>
														<Menu.Item
															onClick={() => {
																setMetadataToUpdate({
																	metadataId: loaderData.metadataId,
																	showSeasonNumber:
																		loaderData.metadataDetails.lot ===
																		MediaLot.Show
																			? loaderData.userMetadataDetails.nextEntry
																					?.season
																			: undefined,
																	showEpisodeNumber:
																		loaderData.metadataDetails.lot ===
																		MediaLot.Show
																			? loaderData.userMetadataDetails.nextEntry
																					?.episode
																			: undefined,
																});
															}}
														>
															Mark{" "}
															{`S${loaderData.userMetadataDetails.nextEntry?.season}-E${loaderData.userMetadataDetails.nextEntry?.episode}`}{" "}
															as seen
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
										{loaderData.metadataDetails.lot === MediaLot.Podcast ? (
											<>
												<Menu.Label>Podcasts</Menu.Label>
												{loaderData.userMetadataDetails.nextEntry ? (
													<>
														<Menu.Item
															onClick={() => {
																setMetadataToUpdate({
																	metadataId: loaderData.metadataId,
																	podcastEpisodeNumber:
																		loaderData.metadataDetails.lot ===
																		MediaLot.Podcast
																			? loaderData.userMetadataDetails.nextEntry
																					?.episode
																			: undefined,
																});
															}}
														>
															Mark EP-
															{
																loaderData.userMetadataDetails.nextEntry
																	?.episode
															}{" "}
															as listened
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
													method="post"
													replace
													onSubmit={() => {
														events.updateProgress(
															loaderData.metadataDetails.title,
														);
													}}
												>
													<HiddenLocationInput />
													<input hidden name="progress" defaultValue={100} />
													<input
														hidden
														name="date"
														defaultValue={formatDateToNaiveDate(new Date())}
													/>
													<Menu.Item
														type="submit"
														name="metadataId"
														value={loaderData.metadataId}
													>
														I finished it
													</Menu.Item>
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
													method="post"
													replace
													onSubmit={() => {
														events.updateProgress(
															loaderData.metadataDetails.title,
														);
													}}
												>
													<HiddenLocationInput />
													<input hidden name="progress" defaultValue={0} />
													{![MediaLot.Anime, MediaLot.Manga].includes(
														loaderData.metadataDetails.lot,
													) ? (
														<Menu.Item
															type="submit"
															name="metadataId"
															value={loaderData.metadataId}
														>
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
								<>
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
								</>
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
										{loaderData.metadataDetails.source !==
										MediaSource.Custom ? (
											<Form
												action="?intent=deployUpdateMetadataJob"
												method="post"
												replace
												onSubmit={async () => {
													await queryClient.invalidateQueries({
														queryKey: [
															"metadataDetails",
															loaderData.metadataId,
														],
													});
												}}
											>
												<Menu.Item
													type="submit"
													name="metadataId"
													value={loaderData.metadataId}
												>
													Update metadata
												</Menu.Item>
											</Form>
										) : null}
										<Menu.Item onClick={mergeMetadataModalOpen}>
											Merge media
										</Menu.Item>
										<MergeMetadataModal
											onClose={mergeMetadataModalClose}
											opened={mergeMetadataModalOpened}
											metadataId={loaderData.metadataId}
										/>
									</Menu.Dropdown>
								</Menu>
							</SimpleGrid>
						</MediaScrollArea>
					</Tabs.Panel>
					<Tabs.Panel value="history">
						{loaderData.userMetadataDetails.seenByAllCount > 0 ||
						loaderData.userMetadataDetails.seenByUserCount > 0 ||
						loaderData.userMetadataDetails.unitsConsumed ? (
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
									{loaderData.userMetadataDetails.unitsConsumed ? (
										<Text fz={{ base: "sm", md: "md" }}>
											Consumed{" "}
											{match(loaderData.metadataDetails.lot)
												.with(
													MediaLot.AudioBook,
													MediaLot.Movie,
													MediaLot.Show,
													MediaLot.Podcast,
													MediaLot.VisualNovel,
													() =>
														humanizeDuration(
															(loaderData.userMetadataDetails.unitsConsumed ||
																0) *
																1000 *
																60,
														),
												)
												.otherwise(
													(v) =>
														`${loaderData.userMetadataDetails.unitsConsumed} ${match(
															v,
														)
															.with(MediaLot.VideoGame, () => "")
															.with(MediaLot.Book, () => "pages")
															.with(MediaLot.Anime, () => "episodes")
															.with(MediaLot.Manga, () => "chapters")
															.exhaustive()}`,
												)}
											.
										</Text>
									) : null}
								</Box>
								<Virtuoso
									data={loaderData.userMetadataDetails.history}
									itemContent={(index, history) => (
										<SeenItem
											history={history}
											key={history.id}
											index={index}
										/>
									)}
								/>
							</Stack>
						) : (
							<Text>No history</Text>
						)}
					</Tabs.Panel>
					<Tabs.Panel value="showSeasons">
						{loaderData.metadataDetails.showSpecifics &&
						loaderData.userMetadataDetails.showProgress ? (
							<Box h={MEDIA_DETAILS_HEIGHT}>
								<GroupedVirtuoso
									groupCounts={loaderData.metadataDetails.showSpecifics.seasons.map(
										(season) => season.episodes.length,
									)}
									groupContent={(index) => (
										<DisplayShowSeason
											seasonIdx={index}
											showProgress={loaderData.userMetadataDetails.showProgress}
										/>
									)}
									itemContent={(index, groupIndex) => (
										<DisplayShowEpisode
											overallIdx={index}
											seasonIdx={groupIndex}
											seasonProgress={
												loaderData.userMetadataDetails.showProgress
											}
											seasonNumber={
												// biome-ignore lint/style/noNonNullAssertion: typescript error
												loaderData.metadataDetails.showSpecifics!.seasons[
													groupIndex
												].seasonNumber
											}
										/>
									)}
								/>
							</Box>
						) : null}
					</Tabs.Panel>
					{loaderData.metadataDetails.podcastSpecifics ? (
						<Tabs.Panel value="podcastEpisodes" h={MEDIA_DETAILS_HEIGHT}>
							<Virtuoso
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
						<Tabs.Panel value="reviews">
							{loaderData.userMetadataDetails.reviews.length > 0 ? (
								<MediaScrollArea>
									<Stack>
										{loaderData.userMetadataDetails.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												entityLot={EntityLot.Metadata}
												entityId={loaderData.metadataId}
												lot={loaderData.metadataDetails.lot}
												title={loaderData.metadataDetails.title}
											/>
										))}
									</Stack>
								</MediaScrollArea>
							) : (
								<Text>No reviews</Text>
							)}
						</Tabs.Panel>
					) : null}
					<Tabs.Panel value="suggestions">
						{loaderData.metadataDetails.suggestions.length > 0 ? (
							<MediaScrollArea>
								<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
									{loaderData.metadataDetails.suggestions.map((sug) => (
										<PartialMetadataDisplay key={sug.identifier} media={sug} />
									))}
								</SimpleGrid>
							</MediaScrollArea>
						) : (
							<Text>No suggestions</Text>
						)}
					</Tabs.Panel>
					{!userPreferences.general.disableVideos ? (
						<Tabs.Panel value="videos">
							<MediaScrollArea>
								<Stack>
									{loaderData.metadataDetails.assets.videos.map((v) => (
										<Box key={v.videoId}>
											<iframe
												width="100%"
												height={200}
												src={
													match(v.source)
														.with(
															MetadataVideoSource.Youtube,
															() => "https://www.youtube.com/embed/",
														)
														.with(
															MetadataVideoSource.Dailymotion,
															() => "https://www.dailymotion.com/embed/video/",
														)
														.with(MetadataVideoSource.Custom, () => "")
														.exhaustive() + v.videoId
												}
												title="YouTube video player"
												allowFullScreen
											/>
										</Box>
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

const AdjustSeenTimesModal = (props: {
	opened: boolean;
	onClose: () => void;
	seenId: string;
	startedAt?: string | null;
	endedAt?: string | null;
}) => {
	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form
				action="?intent=editSeenItem"
				method="post"
				replace
				onSubmit={props.onClose}
			>
				<Stack>
					<Title order={3}>Adjust seen times</Title>
					<DateInput
						label="Start time"
						required
						name="startedOn"
						defaultValue={
							props.startedAt ? new Date(props.startedAt) : undefined
						}
					/>
					<DateInput
						label="End time"
						required
						name="finishedOn"
						defaultValue={props.endedAt ? new Date(props.endedAt) : undefined}
					/>
					<Button
						variant="outline"
						type="submit"
						name="seenId"
						value={props.seenId}
					>
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
			<Form method="post" action="?intent=mergeMetadata" replace>
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
	isEpisode?: boolean;
}) => {
	const display = [
		props.runtime
			? humanizeDuration(
					dayjsLib.duration(props.runtime, "minutes").asMilliseconds(),
					{ units: ["h", "m"] },
				)
			: null,
		props.publishDate ? dayjsLib(props.publishDate).format("ll") : null,
		props.numEpisodes ? `${props.numEpisodes} episodes` : null,
	]
		.filter(Boolean)
		.join("; ");

	const isSeen = props.displayIndicator >= 1;

	const DisplayDetails = () => (
		<>
			<Text lineClamp={2}>{props.name}</Text>
			{display ? (
				<Text size="xs" c="dimmed">
					{display}
				</Text>
			) : null}
		</>
	);

	return (
		<Stack data-episode-id={props.id}>
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
						color="red"
						zIndex={props.isEpisode ? "auto" : undefined}
					>
						<Avatar
							src={props.posterImages[0]}
							name={props.name}
							radius="xl"
							size="lg"
							imageProps={{ loading: "lazy" }}
							style={props.isEpisode ? { zIndex: -1 } : {}}
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
					// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
					dangerouslySetInnerHTML={{ __html: props.overview }}
					lineClamp={5}
				/>
			) : null}
		</Stack>
	);
};

type History =
	UserMetadataDetailsQuery["userMetadataDetails"]["history"][number];

const SeenItem = (props: { history: History; index: number }) => {
	const loaderData = useLoaderData<typeof loader>();
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
	const displayShowExtraInformation = showExtraInformation
		? `S${props.history.showExtraInformation?.season}-E${props.history.showExtraInformation?.episode}: ${showExtraInformation.name}`
		: null;
	const podcastExtraInformation = props.history.podcastExtraInformation
		? loaderData.metadataDetails.podcastSpecifics?.episodes.find(
				(e) => e.number === props.history.podcastExtraInformation?.episode,
			)
		: null;
	const displayPodcastExtraInformation = podcastExtraInformation
		? `EP-${props.history.podcastExtraInformation?.episode}: ${podcastExtraInformation.title}`
		: null;
	const displayAnimeExtraInformation = props.history.animeExtraInformation
		?.episode
		? `EP-${props.history.animeExtraInformation?.episode}`
		: null;
	const displayMangaExtraInformation = props.history.mangaExtraInformation
		?.chapter
		? `CH-${props.history.mangaExtraInformation.chapter}`
		: props.history.mangaExtraInformation?.volume
			? `VOL-${props.history.mangaExtraInformation.volume}`
			: null;
	const watchedOnInformation = props.history.providerWatchedOn;

	const displayAllInformation = [
		displayShowExtraInformation,
		displayPodcastExtraInformation,
		displayAnimeExtraInformation,
		displayMangaExtraInformation,
		watchedOnInformation,
	]
		.filter(Boolean)
		.join("; ");

	const timeSpentInMilliseconds = (props.history.totalTimeSpent || 0) * 1000;
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
					<Form action="?intent=deleteSeenItem" method="post" replace>
						<input hidden name="seenId" defaultValue={props.history.id} />
						<ActionIcon
							color="red"
							type="submit"
							onClick={(e) => {
								if (
									!confirm(
										"Are you sure you want to delete this record from history?",
									)
								)
									e.preventDefault();
							}}
						>
							<IconX size={20} />
						</ActionIcon>
					</Form>
					{props.history.state === SeenState.Completed ? (
						<ActionIcon color="blue" onClick={open}>
							<IconEdit size={20} />
						</ActionIcon>
					) : null}
				</Flex>
				<Stack gap={4}>
					<Flex gap="lg">
						<Text fw="bold">
							{changeCase(props.history.state)}{" "}
							{props.history.progress !== "100"
								? `(${Number(props.history.progress).toFixed(2)}%)`
								: null}
						</Text>
						{displayAllInformation ? (
							<Text c="dimmed" lineClamp={1}>
								{displayAllInformation}
							</Text>
						) : null}
					</Flex>
					<SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: 2 }}>
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
			<AdjustSeenTimesModal
				opened={opened}
				onClose={close}
				seenId={props.history.id}
				startedAt={props.history.startedOn}
				endedAt={props.history.finishedOn}
			/>
		</>
	);
};

const DisplayShowSeason = (props: {
	seasonIdx: number;
	showProgress: UserMetadataDetailsQuery["userMetadataDetails"]["showProgress"];
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const season =
		loaderData.metadataDetails.showSpecifics?.seasons[props.seasonIdx];
	const numTimesSeen = props.showProgress?.[props.seasonIdx]?.timesSeen || 0;
	const isSeen = numTimesSeen > 0;

	invariant(season, "Season not found");

	return (
		<Paper my="xs" py="sm">
			<DisplaySeasonOrEpisodeDetails
				{...season}
				name={`${season.seasonNumber}. ${season.name}`}
				numEpisodes={season.episodes.length}
				displayIndicator={numTimesSeen}
				runtime={season.episodes
					.map((e) => e.runtime || 0)
					.reduce((i, a) => i + a, 0)}
			>
				<>
					{season.episodes.length > 0 ? (
						<Button
							variant={isSeen ? "default" : "outline"}
							color="blue"
							onClick={() => {
								setMetadataToUpdate({
									metadataId: loaderData.metadataId,
									showSeasonNumber: season.seasonNumber,
									onlySeason: true,
								});
							}}
						>
							{isSeen ? "Rewatch this" : "Mark as seen"}
						</Button>
					) : null}
				</>
			</DisplaySeasonOrEpisodeDetails>
		</Paper>
	);
};

const DisplayShowEpisode = (props: {
	seasonIdx: number;
	overallIdx: number;
	seasonNumber: number;
	seasonProgress: UserMetadataDetailsQuery["userMetadataDetails"]["showProgress"];
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, setMetadataToUpdate] = useMetadataProgressUpdate();
	const flattenedEpisodes =
		loaderData.metadataDetails.showSpecifics?.seasons.flatMap(
			(season) => season.episodes,
		) || [];
	const episode = flattenedEpisodes[props.overallIdx];
	const flattenedProgress =
		props.seasonProgress?.flatMap((season) => season.episodes) || [];
	const episodeProgress = flattenedProgress[props.overallIdx];
	const numTimesEpisodeSeen = episodeProgress?.timesSeen || 0;

	invariant(episode, "Episode not found");

	return (
		<Box my="lg" ml="md">
			<DisplaySeasonOrEpisodeDetails
				{...episode}
				key={episode.episodeNumber}
				name={`${episode.episodeNumber}. ${episode.name}`}
				publishDate={episode.publishDate}
				displayIndicator={numTimesEpisodeSeen}
				isEpisode
			>
				<Button
					variant={numTimesEpisodeSeen > 0 ? "default" : "outline"}
					color="blue"
					onClick={() => {
						setMetadataToUpdate({
							metadataId: loaderData.metadataId,
							showSeasonNumber: props.seasonNumber,
							showEpisodeNumber: episode.episodeNumber,
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
