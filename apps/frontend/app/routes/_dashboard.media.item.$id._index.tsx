import { $path } from "@ignisda/remix-routes";
import {
	Accordion,
	ActionIcon,
	Alert,
	Anchor,
	Autocomplete,
	Avatar,
	Box,
	Button,
	Checkbox,
	Container,
	Divider,
	Flex,
	Group,
	Image,
	Indicator,
	Menu,
	Modal,
	NumberInput,
	Paper,
	ScrollArea,
	Select,
	SimpleGrid,
	Skeleton,
	Slider,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { DateInput, DatePickerInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	defer,
	json,
	redirect,
} from "@remix-run/node";
import { Await, Form, Link, useLoaderData } from "@remix-run/react";
import {
	DeleteSeenItemDocument,
	DeployBulkProgressUpdateDocument,
	DeployUpdateMetadataJobDocument,
	EditSeenItemDocument,
	EntityLot,
	MediaLot,
	MediaSource,
	MergeMetadataDocument,
	MetadataAdditionalDetailsDocument,
	type MetadataAdditionalDetailsQuery,
	MetadataMainDetailsDocument,
	MetadataVideoSource,
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
	IconBook,
	IconBrandPagekit,
	IconBulb,
	IconClock,
	IconDeviceTv,
	IconEdit,
	IconInfoCircle,
	IconMessageCircle2,
	IconMovie,
	IconPercentage,
	IconPlayerPlay,
	IconRotateClockwise,
	IconStarFilled,
	IconUser,
	IconVideo,
	IconX,
} from "@tabler/icons-react";
import { Fragment, type ReactNode, Suspense, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import {
	AddEntityToCollectionModal,
	HiddenLocationInput,
	MediaDetailsLayout,
} from "~/components/common";
import {
	CreateOwnershipModal,
	CreateReminderModal,
	DisplayCollection,
	DisplayMediaOwned,
	DisplayMediaReminder,
	MediaIsPartial,
	MediaScrollArea,
	PartialMetadataDisplay,
	type PostReview,
	PostReviewModal,
	ReviewItemDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import events from "~/lib/events";
import { Verb, dayjsLib, getVerb, redirectToQueryParam } from "~/lib/generals";
import { useGetMantineColor } from "~/lib/hooks";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getCoreDetails,
	getUserCollectionsList,
	getUserDetails,
	getUserPreferences,
	gqlClient,
	redirectWithToast,
} from "~/lib/utilities.server";
import {
	MetadataSpecificsSchema,
	processSubmission,
} from "~/lib/utilities.server";

const JUSTWATCH_URL = "https://www.justwatch.com";

const searchParamsSchema = z
	.object({
		defaultTab: z.string().optional(),
		openProgressModal: zx.BoolAsString.optional(),
		openReviewModal: zx.BoolAsString.optional(),
		[redirectToQueryParam]: z.string().optional(),
	})
	.merge(MetadataSpecificsSchema);

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const id = params.id;
	invariant(id, "No ID provided");
	const metadataId = Number.parseInt(id);
	const headers = await getAuthorizationHeader(request);
	const [
		coreDetails,
		userPreferences,
		userDetails,
		{ metadataDetails: mediaMainDetails },
		collections,
	] = await Promise.all([
		getCoreDetails(request),
		getUserPreferences(request),
		getUserDetails(request),
		gqlClient.request(MetadataMainDetailsDocument, { metadataId }),
		getUserCollectionsList(request),
	]);
	const mediaAdditionalDetails = gqlClient.request(
		MetadataAdditionalDetailsDocument,
		{ metadataId },
	);
	const userMediaDetails = gqlClient.request(
		UserMetadataDetailsDocument,
		{ metadataId },
		headers,
	);
	return defer({
		query,
		userPreferences: {
			reviewScale: userPreferences.general.reviewScale,
			videosDisabled: userPreferences.general.disableVideos,
			watchProvidersDisabled: userPreferences.general.disableWatchProviders,
			peopleEnabled: userPreferences.featuresEnabled.media.people,
			groupsEnabled: userPreferences.featuresEnabled.media.groups,
			genresEnabled: userPreferences.featuresEnabled.media.genres,
			watchProviders: userPreferences.general.watchProviders,
			disableReviews: userPreferences.general.disableReviews,
		},
		coreDetails: { itemDetailsHeight: coreDetails.itemDetailsHeight },
		userDetails,
		metadataId,
		mediaMainDetails,
		mediaAdditionalDetails,
		userMediaDetails,
		collections,
	});
};

export const meta: MetaFunction = ({ data }) => {
	// biome-ignore lint/suspicious/noExplicitAny:
	return [{ title: `${(data as any).mediaMainDetails.title} | Ryot` }];
};

const sleepForASecond = () =>
	new Promise((resolve) => setTimeout(resolve, 1000));

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		individualProgressUpdate: async () => {
			const submission = processSubmission(formData, bulkUpdateSchema);
			await gqlClient.request(
				DeployBulkProgressUpdateDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			await sleepForASecond();
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Progress updated successfully",
				}),
			});
		},
		deleteSeenItem: async () => {
			const submission = processSubmission(formData, seenIdSchema);
			await gqlClient.request(
				DeleteSeenItemDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Record deleted successfully",
				}),
			});
		},
		deployUpdateMetadataJob: async () => {
			const submission = processSubmission(formData, metadataIdSchema);
			await gqlClient.request(
				DeployUpdateMetadataJobDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Metadata update job deployed successfully",
				}),
			});
		},
		mergeMetadata: async () => {
			const submission = processSubmission(formData, mergeMetadataSchema);
			await gqlClient.request(
				MergeMetadataDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return redirectWithToast(
				$path("/media/item/:id", { id: submission.mergeInto }),
				{ type: "success", message: "Metadata merged successfully" },
			);
		},
		editSeenItem: async () => {
			const submission = processSubmission(formData, editSeenItem);
			await gqlClient.request(
				EditSeenItemDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Adjusted seen item successfully",
				}),
			});
		},
		progressUpdate: async () => {
			const submission = processSubmission(formData, progressUpdateSchema);
			const variables = {
				metadataId: submission.metadataId,
				progress: "100",
				date: submission.date,
				showSeasonNumber: submission.showSeasonNumber,
				showEpisodeNumber: submission.showEpisodeNumber,
				podcastEpisodeNumber: submission.podcastEpisodeNumber,
				animeEpisodeNumber: submission.animeEpisodeNumber,
				mangaChapterNumber: submission.mangaChapterNumber,
				providerWatchedOn: submission.providerWatchedOn,
			};
			let needsFinalUpdate = true;
			const updates = [];
			const showSpecifics = showSpecificsSchema.parse(
				JSON.parse(submission.showSpecifics || "[]"),
			);
			const podcastSpecifics = podcastSpecificsSchema.parse(
				JSON.parse(submission.podcastSpecifics || "[]"),
			);
			if (submission.metadataLot === MediaLot.Anime) {
				if (submission.animeEpisodeNumber) {
					if (submission.animeAllEpisodesBefore) {
						for (let i = 1; i <= submission.animeEpisodeNumber; i++) {
							updates.push({
								...variables,
								animeEpisodeNumber: i,
							});
						}
						needsFinalUpdate = false;
					}
				}
			}
			if (submission.metadataLot === MediaLot.Manga) {
				if (submission.mangaChapterNumber) {
					if (submission.mangaAllChaptersBefore) {
						for (let i = 1; i <= submission.mangaChapterNumber; i++) {
							updates.push({
								...variables,
								mangaChapterNumber: i,
							});
						}
						needsFinalUpdate = false;
					}
				}
			}
			if (submission.metadataLot === MediaLot.Show) {
				if (submission.completeShow) {
					for (const season of showSpecifics) {
						for (const episode of season.episodes) {
							updates.push({
								...variables,
								showSeasonNumber: season.seasonNumber,
								showEpisodeNumber: episode,
							});
						}
					}
					needsFinalUpdate = false;
				}
				if (submission.onlySeason) {
					const selectedSeason = showSpecifics.find(
						(s) => s.seasonNumber === submission.showSeasonNumber,
					);
					invariant(selectedSeason, "No season selected");
					needsFinalUpdate = false;
					if (submission.showAllSeasonsBefore) {
						for (const season of showSpecifics) {
							if (season.seasonNumber > selectedSeason.seasonNumber) break;
							for (const episode of season.episodes || []) {
								updates.push({
									...variables,
									showSeasonNumber: season.seasonNumber,
									showEpisodeNumber: episode,
								});
							}
						}
					} else {
						for (const episode of selectedSeason.episodes || []) {
							updates.push({
								...variables,
								showEpisodeNumber: episode,
							});
						}
					}
				}
			}
			if (submission.metadataLot === MediaLot.Podcast) {
				if (submission.completePodcast) {
					for (const episode of podcastSpecifics) {
						updates.push({
							...variables,
							podcastEpisodeNumber: episode.episodeNumber,
						});
					}
					needsFinalUpdate = false;
				}
			}
			if (needsFinalUpdate) updates.push(variables);
			const { deployBulkProgressUpdate } = await gqlClient.request(
				DeployBulkProgressUpdateDocument,
				{ input: updates },
				await getAuthorizationHeader(request),
			);
			await sleepForASecond();
			const headers = {
				headers: await createToastHeaders({
					type: !deployBulkProgressUpdate ? "error" : "success",
					message: !deployBulkProgressUpdate
						? "Progress was not updated"
						: "Progress updated successfully",
				}),
			};
			if (submission[redirectToQueryParam])
				return redirect(submission[redirectToQueryParam], headers);
			return json({ status: "success", submission } as const, headers);
		},
	});
};

const metadataIdSchema = z.object({ metadataId: zx.IntAsString });

const bulkUpdateSchema = z
	.object({
		progress: z.string().optional(),
		date: z.string().optional(),
		changeState: z.nativeEnum(SeenState).optional(),
		providerWatchedOn: z.string().optional(),
	})
	.merge(MetadataSpecificsSchema)
	.merge(metadataIdSchema);

const seenIdSchema = z.object({ seenId: zx.IntAsString });

const mergeMetadataSchema = z.object({
	mergeFrom: zx.IntAsString,
	mergeInto: zx.IntAsString,
});

const dateString = z
	.string()
	.transform((v) => formatDateToNaiveDate(new Date(v)));

const editSeenItem = z.object({
	seenId: zx.IntAsString,
	startedOn: dateString.optional(),
	finishedOn: dateString.optional(),
});

const progressUpdateSchema = z
	.object({
		metadataLot: z.nativeEnum(MediaLot),
		date: z.string().optional(),
		[redirectToQueryParam]: z.string().optional(),
		showSpecifics: z.string().optional(),
		showAllSeasonsBefore: zx.CheckboxAsString.optional(),
		podcastSpecifics: z.string().optional(),
		onlySeason: zx.BoolAsString.optional(),
		completeShow: zx.BoolAsString.optional(),
		completePodcast: zx.BoolAsString.optional(),
		animeAllEpisodesBefore: zx.CheckboxAsString.optional(),
		mangaAllChaptersBefore: zx.CheckboxAsString.optional(),
		providerWatchedOn: z.string().optional(),
	})
	.merge(metadataIdSchema)
	.merge(MetadataSpecificsSchema);

const showSpecificsSchema = z.array(
	z.object({ seasonNumber: z.number(), episodes: z.array(z.number()) }),
);

const podcastSpecificsSchema = z.array(z.object({ episodeNumber: z.number() }));

// DEV: I wanted to use fetcher in some place but since this is being rendered
// conditionally (or inside a menu), the form ref is null.

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const getMantineColor = useGetMantineColor();

	const [
		progressModalOpened,
		{ open: progressModalOpen, close: progressModalClose },
	] = useDisclosure(false);
	const [
		collectionModalOpened,
		{ open: collectionModalOpen, close: collectionModalClose },
	] = useDisclosure(false);
	const [
		createMediaReminderModalOpened,
		{
			open: createMediaReminderModalOpen,
			close: createMediaReminderModalClose,
		},
	] = useDisclosure(false);
	const [
		mediaOwnershipModalOpened,
		{ open: mediaOwnershipModalOpen, close: mediaOwnershipModalClose },
	] = useDisclosure(false);
	const [
		mergeMetadataModalOpened,
		{ open: mergeMetadataModalOpen, close: mergeMetadataModalClose },
	] = useDisclosure(false);
	const [updateProgressModalData, setUpdateProgressModalData] = useState<
		UpdateProgress | undefined
	>(loaderData.query.openProgressModal ? {} : undefined);
	const [postReviewModalData, setPostReviewModalData] = useState<
		PostReview | undefined
	>(loaderData.query.openReviewModal ? {} : undefined);

	const PutOnHoldBtn = () => {
		return (
			<Form
				action="?intent=individualProgressUpdate"
				method="post"
				replace
				onSubmit={() => {
					events.updateProgress(loaderData.mediaMainDetails.title);
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
				action="?intent=individualProgressUpdate"
				method="post"
				replace
				onSubmit={() => {
					events.updateProgress(loaderData.mediaMainDetails.title);
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
		<>
			<CreateReminderModal
				onClose={createMediaReminderModalClose}
				opened={createMediaReminderModalOpened}
				defaultText={`Complete '${loaderData.mediaMainDetails.title}'`}
				metadataId={loaderData.metadataId}
			/>
			<CreateOwnershipModal
				onClose={mediaOwnershipModalClose}
				opened={mediaOwnershipModalOpened}
				metadataId={loaderData.metadataId}
			/>
			<MergeMetadataModal
				onClose={mergeMetadataModalClose}
				opened={mergeMetadataModalOpened}
				metadataId={loaderData.metadataId}
			/>
			<ProgressUpdateModal
				onClose={() => setUpdateProgressModalData(undefined)}
				opened={updateProgressModalData !== undefined}
				data={updateProgressModalData}
			/>
			<PostReviewModal
				onClose={() => setPostReviewModalData(undefined)}
				opened={postReviewModalData !== undefined}
				data={postReviewModalData}
				entityType="metadata"
				objectId={loaderData.metadataId}
				reviewScale={loaderData.userPreferences.reviewScale}
				title={loaderData.mediaMainDetails.title}
				lot={loaderData.mediaMainDetails.lot}
			/>
			<Container>
				<MediaDetailsLayout
					images={loaderData.mediaMainDetails.assets.images}
					externalLink={{
						source: loaderData.mediaMainDetails.source,
						lot: loaderData.mediaMainDetails.lot,
						href: loaderData.mediaMainDetails.sourceUrl,
					}}
				>
					<Box>
						{loaderData.userPreferences.groupsEnabled &&
						loaderData.mediaMainDetails.group ? (
							<Link
								to={$path("/media/groups/item/:id", {
									id: loaderData.mediaMainDetails.group.id,
								})}
								style={{ color: "unset" }}
							>
								<Text c="dimmed" fs="italic">
									{loaderData.mediaMainDetails.group.name} #
									{loaderData.mediaMainDetails.group.part}
								</Text>
							</Link>
						) : null}
						<Title id="media-title">{loaderData.mediaMainDetails.title}</Title>
					</Box>
					<UserMetadataDetailsSuspenseLoader>
						{(userMetadataDetails) => (
							<Group>
								{userMetadataDetails.collections.map((col) => (
									<DisplayCollection
										col={col}
										entityId={loaderData.metadataId.toString()}
										entityLot={EntityLot.Media}
										key={col.id}
									/>
								))}
								{userMetadataDetails.ownership ? <DisplayMediaOwned /> : null}
								{loaderData.mediaMainDetails.isPartial ? (
									<MediaIsPartial mediaType="media" />
								) : null}
							</Group>
						)}
					</UserMetadataDetailsSuspenseLoader>
					<MediaAdditionalDetailsSuspenseLoader>
						{(mediaAdditionalDetails) => (
							<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
								{[
									loaderData.mediaMainDetails.publishDate
										? dayjsLib(loaderData.mediaMainDetails.publishDate).format(
												"LL",
										  )
										: loaderData.mediaMainDetails.publishYear,
									loaderData.mediaMainDetails.originalLanguage,
									loaderData.mediaMainDetails.productionStatus,
									mediaAdditionalDetails.bookSpecifics?.pages &&
										`${mediaAdditionalDetails.bookSpecifics.pages} pages`,
									mediaAdditionalDetails.podcastSpecifics?.totalEpisodes &&
										`${mediaAdditionalDetails.podcastSpecifics.totalEpisodes} episodes`,
									mediaAdditionalDetails.animeSpecifics?.episodes &&
										`${mediaAdditionalDetails.animeSpecifics.episodes} episodes`,
									mediaAdditionalDetails.mangaSpecifics?.chapters &&
										`${mediaAdditionalDetails.mangaSpecifics.chapters} chapters`,
									mediaAdditionalDetails.mangaSpecifics?.volumes &&
										`${mediaAdditionalDetails.mangaSpecifics.volumes} volumes`,
									mediaAdditionalDetails.movieSpecifics?.runtime &&
										humanizeDuration(
											mediaAdditionalDetails.movieSpecifics.runtime * 1000 * 60,
										),
									mediaAdditionalDetails.showSpecifics?.totalSeasons &&
										`${mediaAdditionalDetails.showSpecifics.totalSeasons} seasons`,
									mediaAdditionalDetails.showSpecifics?.totalEpisodes &&
										`${mediaAdditionalDetails.showSpecifics.totalEpisodes} episodes`,
									mediaAdditionalDetails.showSpecifics?.runtime &&
										humanizeDuration(
											mediaAdditionalDetails.showSpecifics.runtime * 1000 * 60,
										),
									mediaAdditionalDetails.audioBookSpecifics?.runtime &&
										humanizeDuration(
											mediaAdditionalDetails.audioBookSpecifics.runtime *
												1000 *
												60,
										),
								]
									.filter(Boolean)
									.join(" • ")}
							</Text>
						)}
					</MediaAdditionalDetailsSuspenseLoader>
					<UserMetadataDetailsSuspenseLoader>
						{(userMetadataDetails) => (
							<>
								{loaderData.mediaMainDetails.providerRating ||
								userMetadataDetails.averageRating ? (
									<Group>
										{loaderData.mediaMainDetails.providerRating ? (
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
														loaderData.mediaMainDetails.source,
													)
														.with(MediaSource.Anilist, () => "anilist.svg")
														.with(MediaSource.Audible, () => "audible.svg")
														.with(
															MediaSource.GoogleBooks,
															() => "google-books.svg",
														)
														.with(MediaSource.Igdb, () => "igdb.svg")
														.with(MediaSource.Itunes, () => "itunes.svg")
														.with(
															MediaSource.Listennotes,
															() => "listennotes.webp",
														)
														.with(MediaSource.Mal, () => "mal.svg")
														.with(
															MediaSource.MangaUpdates,
															() => "manga-updates.svg",
														)
														.with(
															MediaSource.Openlibrary,
															() => "openlibrary.svg",
														)
														.with(MediaSource.Tmdb, () => "tmdb.svg")
														.with(MediaSource.Vndb, () => "vndb.ico")
														.with(MediaSource.Custom, () => undefined)
														.exhaustive()}`}
												/>
												<Text fz="sm">
													{Number(
														loaderData.mediaMainDetails.providerRating,
													).toFixed(1)}
													{match(loaderData.mediaMainDetails.source)
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
										{userMetadataDetails.averageRating ? (
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
													style={{ color: "#EBE600FF" }}
												/>
												<Text fz="sm">
													{Number(userMetadataDetails.averageRating).toFixed(1)}
													{loaderData.userPreferences.reviewScale ===
													UserReviewScale.OutOfFive
														? undefined
														: "%"}
												</Text>
											</Paper>
										) : null}
									</Group>
								) : null}
								{userMetadataDetails?.reminder ? (
									<DisplayMediaReminder
										reminderData={userMetadataDetails.reminder}
									/>
								) : null}
								{userMetadataDetails?.inProgress ? (
									<Alert icon={<IconAlertCircle />} variant="outline">
										You are currently{" "}
										{getVerb(Verb.Read, loaderData.mediaMainDetails.lot)}
										ing this (
										{Number(userMetadataDetails.inProgress.progress).toFixed(2)}
										%)
									</Alert>
								) : null}
							</>
						)}
					</UserMetadataDetailsSuspenseLoader>
					<Tabs
						variant="outline"
						defaultValue={loaderData.query.defaultTab || "overview"}
					>
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
							{loaderData.mediaMainDetails.lot === MediaLot.Show ? (
								<Tabs.Tab
									value="seasons"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Seasons
								</Tabs.Tab>
							) : null}
							{loaderData.mediaMainDetails.lot === MediaLot.Podcast ? (
								<Tabs.Tab
									value="episodes"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Episodes
								</Tabs.Tab>
							) : null}
							{!loaderData.userPreferences.disableReviews ? (
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
							{!loaderData.userPreferences.videosDisabled &&
							(loaderData.mediaMainDetails.assets.videos.length || 0) > 0 ? (
								<Tabs.Tab value="videos" leftSection={<IconVideo size={16} />}>
									Videos
								</Tabs.Tab>
							) : null}
							{!loaderData.userPreferences.watchProvidersDisabled ? (
								<Tabs.Tab
									value="watchProviders"
									leftSection={<IconMovie size={16} />}
								>
									Watch On
								</Tabs.Tab>
							) : null}
						</Tabs.List>
						<Tabs.Panel value="overview">
							<MediaScrollArea
								itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
							>
								<Stack gap="sm">
									<SimpleGrid
										cols={{ base: 3, xl: 4 }}
										spacing={{ base: "md", lg: "xs" }}
									>
										{loaderData.userPreferences.genresEnabled
											? loaderData.mediaMainDetails.genres
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
									{loaderData.mediaMainDetails.description ? (
										<div
											// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
											dangerouslySetInnerHTML={{
												__html: loaderData.mediaMainDetails.description,
											}}
										/>
									) : null}
									{loaderData.userPreferences.peopleEnabled ? (
										<Stack>
											<MediaAdditionalDetailsSuspenseLoader>
												{(mediaAdditionalDetails) =>
													mediaAdditionalDetails.creators.map((c) => (
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
													))
												}
											</MediaAdditionalDetailsSuspenseLoader>
										</Stack>
									) : null}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="actions">
							<MediaScrollArea
								itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
							>
								<UserMetadataDetailsSuspenseLoader>
									{(userMetadataDetails) => (
										<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
											<MediaAdditionalDetailsSuspenseLoader>
												{(mediaAdditionalDetails) => (
													<>
														{userMetadataDetails.inProgress ? (
															<IndividualProgressModal
																title={loaderData.mediaMainDetails.title}
																progress={Number(
																	userMetadataDetails.inProgress.progress,
																)}
																inProgress={userMetadataDetails.inProgress}
																metadataId={loaderData.metadataId}
																onClose={progressModalClose}
																opened={progressModalOpened}
																lot={loaderData.mediaMainDetails.lot}
																total={
																	mediaAdditionalDetails.audioBookSpecifics
																		?.runtime ||
																	mediaAdditionalDetails.bookSpecifics?.pages ||
																	mediaAdditionalDetails.movieSpecifics
																		?.runtime ||
																	mediaAdditionalDetails.mangaSpecifics
																		?.chapters ||
																	mediaAdditionalDetails.animeSpecifics
																		?.episodes ||
																	mediaAdditionalDetails.visualNovelSpecifics
																		?.length
																}
															/>
														) : null}
													</>
												)}
											</MediaAdditionalDetailsSuspenseLoader>
											<Menu shadow="md">
												<Menu.Target>
													<Button variant="outline">Update progress</Button>
												</Menu.Target>
												<Menu.Dropdown>
													{loaderData.mediaMainDetails.lot === MediaLot.Show ? (
														<>
															<Menu.Label>Shows</Menu.Label>
															{userMetadataDetails.nextEntry ? (
																<>
																	<Menu.Item
																		onClick={() => {
																			setUpdateProgressModalData({
																				showSeasonNumber:
																					loaderData.mediaMainDetails.lot ===
																					MediaLot.Show
																						? userMetadataDetails.nextEntry
																								?.season
																						: undefined,
																				showEpisodeNumber:
																					loaderData.mediaMainDetails.lot ===
																					MediaLot.Show
																						? userMetadataDetails.nextEntry
																								?.episode
																						: undefined,
																			});
																		}}
																	>
																		Mark{" "}
																		{`S${userMetadataDetails.nextEntry?.season}-E${userMetadataDetails.nextEntry?.episode}`}{" "}
																		as seen
																	</Menu.Item>
																	<PutOnHoldBtn />
																</>
															) : null}
															{userMetadataDetails &&
															userMetadataDetails.history.length !== 0 ? (
																<DropBtn />
															) : (
																<Menu.Item disabled>
																	No history. Update from the seasons tab.
																</Menu.Item>
															)}
														</>
													) : null}
													{loaderData.mediaMainDetails.lot ===
													MediaLot.Podcast ? (
														<>
															<Menu.Label>Podcasts</Menu.Label>
															{userMetadataDetails.nextEntry ? (
																<>
																	<Menu.Item
																		onClick={() => {
																			setUpdateProgressModalData({
																				podcastEpisodeNumber:
																					loaderData.mediaMainDetails.lot ===
																					MediaLot.Podcast
																						? userMetadataDetails.nextEntry
																								?.episode
																						: undefined,
																			});
																		}}
																	>
																		Mark EP-
																		{userMetadataDetails.nextEntry?.episode} as
																		listened
																	</Menu.Item>
																	<PutOnHoldBtn />
																</>
															) : null}
															{userMetadataDetails &&
															userMetadataDetails.history.length !== 0 ? (
																<DropBtn />
															) : (
																<Menu.Item disabled>
																	No history. Update from the episodes tab.
																</Menu.Item>
															)}
														</>
													) : null}
													{userMetadataDetails?.inProgress ? (
														<>
															<Menu.Label>In progress</Menu.Label>
															<Form
																action="?intent=individualProgressUpdate"
																method="post"
																replace
																onSubmit={() => {
																	events.updateProgress(
																		loaderData.mediaMainDetails.title,
																	);
																}}
															>
																<input
																	hidden
																	name="progress"
																	defaultValue={100}
																/>
																<input
																	hidden
																	name="date"
																	defaultValue={formatDateToNaiveDate(
																		new Date(),
																	)}
																/>
																<Menu.Item
																	type="submit"
																	name="metadataId"
																	value={loaderData.metadataId}
																>
																	I finished{" "}
																	{getVerb(
																		Verb.Read,
																		loaderData.mediaMainDetails.lot,
																	)}
																	ing it
																</Menu.Item>
															</Form>
															<Menu.Item onClick={progressModalOpen}>
																Set progress
															</Menu.Item>
															{loaderData.mediaMainDetails.lot !==
																MediaLot.Show &&
															loaderData.mediaMainDetails.lot !==
																MediaLot.Podcast ? (
																<StateChangeButtons />
															) : null}
														</>
													) : loaderData.mediaMainDetails.lot !==
															MediaLot.Show &&
													  loaderData.mediaMainDetails.lot !==
															MediaLot.Podcast ? (
														<>
															<Menu.Label>Not in progress</Menu.Label>
															<Form
																action="?intent=individualProgressUpdate"
																method="post"
																replace
																onSubmit={() => {
																	events.updateProgress(
																		loaderData.mediaMainDetails.title,
																	);
																}}
															>
																<input
																	hidden
																	name="progress"
																	defaultValue={0}
																/>
																{![MediaLot.Anime, MediaLot.Manga].includes(
																	loaderData.mediaMainDetails.lot,
																) ? (
																	<Menu.Item
																		type="submit"
																		name="metadataId"
																		value={loaderData.metadataId}
																	>
																		I'm{" "}
																		{getVerb(
																			Verb.Read,
																			loaderData.mediaMainDetails.lot,
																		)}
																		ing it
																	</Menu.Item>
																) : null}
															</Form>
															<Menu.Item
																onClick={() => {
																	setUpdateProgressModalData({});
																}}
															>
																Add to{" "}
																{getVerb(
																	Verb.Read,
																	loaderData.mediaMainDetails.lot,
																)}{" "}
																history
															</Menu.Item>
														</>
													) : null}
												</Menu.Dropdown>
											</Menu>
											{!loaderData.userPreferences.disableReviews ? (
												<Button
													variant="outline"
													w="100%"
													onClick={() => {
														setPostReviewModalData({
															showSeasonNumber:
																userMetadataDetails?.nextEntry?.season ??
																undefined,
															showEpisodeNumber:
																loaderData.mediaMainDetails.lot ===
																MediaLot.Show
																	? userMetadataDetails?.nextEntry?.episode ??
																	  undefined
																	: null,
															podcastEpisodeNumber:
																loaderData.mediaMainDetails.lot ===
																MediaLot.Podcast
																	? userMetadataDetails?.nextEntry?.episode ??
																	  undefined
																	: null,
														});
													}}
												>
													Post a review
												</Button>
											) : null}
											<>
												<Button variant="outline" onClick={collectionModalOpen}>
													Add to collection
												</Button>
												<AddEntityToCollectionModal
													onClose={collectionModalClose}
													opened={collectionModalOpened}
													entityId={loaderData.metadataId.toString()}
													entityLot={EntityLot.Media}
													collections={loaderData.collections.map(
														(c) => c.name,
													)}
												/>
											</>
											<Menu shadow="md">
												<Menu.Target>
													<Button variant="outline">More actions</Button>
												</Menu.Target>
												<Menu.Dropdown>
													<UserMetadataDetailsSuspenseLoader>
														{(userMetadataDetails) => (
															<ToggleMediaMonitorMenuItem
																inCollections={userMetadataDetails.collections.map(
																	(c) => c.name,
																)}
																formValue={loaderData.metadataId}
																entityLot={EntityLot.Media}
															/>
														)}
													</UserMetadataDetailsSuspenseLoader>
													<Form
														action="?intent=deployUpdateMetadataJob"
														method="post"
														replace
													>
														<Menu.Item
															type="submit"
															name="metadataId"
															value={loaderData.metadataId}
														>
															Update metadata
														</Menu.Item>
													</Form>
													{userMetadataDetails.reminder ? (
														<Form
															action="/actions?intent=deleteMediaReminder"
															method="post"
															replace
														>
															<input
																hidden
																name="metadataId"
																value={loaderData.metadataId}
																readOnly
															/>
															<HiddenLocationInput />
															<Menu.Item
																type="submit"
																color="red"
																onClick={(e) => {
																	if (
																		!confirm(
																			"Are you sure you want to delete this reminder?",
																		)
																	)
																		e.preventDefault();
																}}
															>
																Remove reminder
															</Menu.Item>
														</Form>
													) : (
														<Menu.Item onClick={createMediaReminderModalOpen}>
															Create reminder
														</Menu.Item>
													)}
													{userMetadataDetails.ownership ? (
														<Form
															action="/actions?intent=toggleMediaOwnership"
															method="post"
															replace
														>
															<HiddenLocationInput />
															<Menu.Item
																type="submit"
																color="red"
																name="metadataId"
																value={loaderData.metadataId}
																onClick={(e) => {
																	if (
																		!confirm(
																			"Are you sure you want to remove ownership of this media?",
																		)
																	)
																		e.preventDefault();
																}}
															>
																Remove ownership
															</Menu.Item>
														</Form>
													) : (
														<Menu.Item onClick={mediaOwnershipModalOpen}>
															Mark as owned
														</Menu.Item>
													)}
													<Menu.Item onClick={mergeMetadataModalOpen}>
														Merge media
													</Menu.Item>
												</Menu.Dropdown>
											</Menu>
										</SimpleGrid>
									)}
								</UserMetadataDetailsSuspenseLoader>
							</MediaScrollArea>
						</Tabs.Panel>
						<MediaAdditionalDetailsSuspenseLoader>
							{(metadataDetails) => (
								<UserMetadataDetailsSuspenseLoader>
									{(userMetadataDetails) => (
										<>
											<Tabs.Panel value="history">
												{userMetadataDetails.seenBy > 0 ||
												userMetadataDetails.history.length > 0 ||
												userMetadataDetails.unitsConsumed ||
												userMetadataDetails.ownership ? (
													<MediaScrollArea
														itemDetailsHeight={
															loaderData.coreDetails.itemDetailsHeight
														}
													>
														<Stack>
															<Box>
																<Text fz={{ base: "sm", md: "md" }}>
																	Seen by all users {userMetadataDetails.seenBy}{" "}
																	time
																	{userMetadataDetails.seenBy > 1 ? "s" : ""}{" "}
																	and {userMetadataDetails.history.length} time
																	{userMetadataDetails &&
																	userMetadataDetails.history.length > 1
																		? "s"
																		: ""}{" "}
																	by you.
																</Text>

																{userMetadataDetails.unitsConsumed ? (
																	<Text fz={{ base: "sm", md: "md" }}>
																		Consumed{" "}
																		{match(loaderData.mediaMainDetails.lot)
																			.with(
																				MediaLot.AudioBook,
																				MediaLot.Movie,
																				MediaLot.Show,
																				MediaLot.Podcast,
																				MediaLot.VisualNovel,
																				() =>
																					humanizeDuration(
																						(userMetadataDetails.unitsConsumed ||
																							0) *
																							1000 *
																							60,
																					),
																			)
																			.otherwise(
																				(v) =>
																					`${
																						userMetadataDetails.unitsConsumed
																					} ${match(v)
																						.with(MediaLot.VideoGame, () => "")
																						.with(MediaLot.Book, () => "pages")
																						.with(
																							MediaLot.Anime,
																							() => "episodes",
																						)
																						.with(
																							MediaLot.Manga,
																							() => "chapters",
																						)
																						.exhaustive()}`,
																			)}
																		.
																	</Text>
																) : null}
															</Box>
															{userMetadataDetails.history.map((h) => (
																<SeenItem
																	history={h}
																	key={h.id}
																	showSpecifics={metadataDetails.showSpecifics}
																	podcastSpecifics={
																		metadataDetails.podcastSpecifics
																	}
																/>
															))}
														</Stack>
													</MediaScrollArea>
												) : (
													<Text>No history</Text>
												)}
											</Tabs.Panel>
										</>
									)}
								</UserMetadataDetailsSuspenseLoader>
							)}
						</MediaAdditionalDetailsSuspenseLoader>
						<UserMetadataDetailsSuspenseLoader>
							{(userMetadataDetails) => (
								<MediaAdditionalDetailsSuspenseLoader>
									{(mediaAdditionalDetails) => (
										<>
											{mediaAdditionalDetails.showSpecifics ? (
												<Tabs.Panel value="seasons">
													<MediaScrollArea
														itemDetailsHeight={
															loaderData.coreDetails.itemDetailsHeight
														}
													>
														<Accordion
															// do not show the chevron at all
															chevron={<Box />}
															variant="contained"
															defaultValue={loaderData.query.showSeasonNumber?.toString()}
														>
															{mediaAdditionalDetails.showSpecifics.seasons.map(
																(s) => (
																	<Accordion.Item
																		value={s.seasonNumber.toString()}
																		key={s.seasonNumber}
																	>
																		<Accordion.Control>
																			<AccordionLabel
																				{...s}
																				name={`${s.seasonNumber}. ${s.name}`}
																				numEpisodes={s.episodes.length}
																				displayIndicator={
																					s.episodes.length > 0 &&
																					s.episodes.every((e) =>
																						userMetadataDetails.history.some(
																							(h) =>
																								h.progress === "100" &&
																								h.showExtraInformation &&
																								h.showExtraInformation
																									.episode ===
																									e.episodeNumber &&
																								h.showExtraInformation
																									.season === s.seasonNumber,
																						),
																					)
																						? 1
																						: 0
																				}
																				runtime={s.episodes
																					.map((e) => e.runtime || 0)
																					.reduce((i, a) => i + a, 0)}
																			>
																				<>
																					{s.episodes.length > 0 ? (
																						<Button
																							variant="outline"
																							onClick={() => {
																								setUpdateProgressModalData({
																									showSeasonNumber:
																										s.seasonNumber,
																									onlySeason: true,
																								});
																							}}
																						>
																							Mark as seen
																						</Button>
																					) : null}
																				</>
																			</AccordionLabel>
																		</Accordion.Control>
																		<Accordion.Panel>
																			{s.episodes.length > 0 ? (
																				s.episodes.map((e) => (
																					<Fragment key={e.id}>
																						<Divider />
																						<Box my="xs" ml="md">
																							<AccordionLabel
																								{...e}
																								key={e.episodeNumber}
																								name={`${e.episodeNumber}. ${e.name}`}
																								publishDate={e.publishDate}
																								displayIndicator={
																									userMetadataDetails.history.filter(
																										(h) =>
																											h.progress === "100" &&
																											h.showExtraInformation &&
																											h.showExtraInformation
																												.episode ===
																												e.episodeNumber &&
																											h.showExtraInformation
																												.season ===
																												s.seasonNumber,
																									).length || 0
																								}
																							>
																								<Button
																									variant="outline"
																									onClick={() => {
																										setUpdateProgressModalData({
																											showSeasonNumber:
																												s.seasonNumber,
																											showEpisodeNumber:
																												e.episodeNumber,
																										});
																									}}
																								>
																									Mark as seen
																								</Button>
																							</AccordionLabel>
																						</Box>
																					</Fragment>
																				))
																			) : (
																				<Text>No episodes in this season</Text>
																			)}
																		</Accordion.Panel>
																	</Accordion.Item>
																),
															)}
														</Accordion>
													</MediaScrollArea>
												</Tabs.Panel>
											) : null}
										</>
									)}
								</MediaAdditionalDetailsSuspenseLoader>
							)}
						</UserMetadataDetailsSuspenseLoader>
						<UserMetadataDetailsSuspenseLoader>
							{(userMetadataDetails) => (
								<MediaAdditionalDetailsSuspenseLoader>
									{(mediaAdditionalDetails) => (
										<>
											{mediaAdditionalDetails.podcastSpecifics ? (
												<Tabs.Panel value="episodes">
													<MediaScrollArea
														itemDetailsHeight={
															loaderData.coreDetails.itemDetailsHeight
														}
													>
														<Stack ml="md">
															{mediaAdditionalDetails.podcastSpecifics.episodes.map(
																(e) => (
																	<AccordionLabel
																		{...e}
																		name={e.title}
																		posterImages={[e.thumbnail || ""]}
																		key={e.number}
																		publishDate={e.publishDate}
																		displayIndicator={
																			userMetadataDetails.history.filter(
																				(h) =>
																					h.podcastExtraInformation?.episode ===
																					e.number,
																			).length || 0
																		}
																	>
																		<Button
																			variant="outline"
																			onClick={() => {
																				setUpdateProgressModalData({
																					podcastEpisodeNumber: e.number,
																				});
																			}}
																		>
																			Mark as seen
																		</Button>
																	</AccordionLabel>
																),
															)}
														</Stack>
													</MediaScrollArea>
												</Tabs.Panel>
											) : null}
										</>
									)}
								</MediaAdditionalDetailsSuspenseLoader>
							)}
						</UserMetadataDetailsSuspenseLoader>
						<UserMetadataDetailsSuspenseLoader>
							{(userMetadataDetails) => (
								<>
									{!loaderData.userPreferences.disableReviews ? (
										<Tabs.Panel value="reviews">
											{userMetadataDetails.reviews.length > 0 ? (
												<MediaScrollArea
													itemDetailsHeight={
														loaderData.coreDetails.itemDetailsHeight
													}
												>
													<Stack>
														{userMetadataDetails.reviews.map((r) => (
															<ReviewItemDisplay
																entityType="metadata"
																review={r}
																key={r.id}
																metadataId={loaderData.metadataId}
																reviewScale={
																	loaderData.userPreferences.reviewScale
																}
																user={loaderData.userDetails}
																title={loaderData.mediaMainDetails.title}
																lot={loaderData.mediaMainDetails.lot}
															/>
														))}
													</Stack>
												</MediaScrollArea>
											) : (
												<Text>No reviews</Text>
											)}
										</Tabs.Panel>
									) : null}
								</>
							)}
						</UserMetadataDetailsSuspenseLoader>
						<Tabs.Panel value="suggestions">
							<MediaAdditionalDetailsSuspenseLoader>
								{(mediaAdditionalDetails) =>
									mediaAdditionalDetails.suggestions.length > 0 ? (
										<MediaScrollArea
											itemDetailsHeight={
												loaderData.coreDetails.itemDetailsHeight
											}
										>
											<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
												{mediaAdditionalDetails.suggestions.map((sug) => (
													<PartialMetadataDisplay
														key={sug.identifier}
														media={sug}
													/>
												))}
											</SimpleGrid>
										</MediaScrollArea>
									) : (
										<Text>No suggestions</Text>
									)
								}
							</MediaAdditionalDetailsSuspenseLoader>
						</Tabs.Panel>
						{!loaderData.userPreferences.videosDisabled ? (
							<Tabs.Panel value="videos">
								<MediaScrollArea
									itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
								>
									<Stack>
										{loaderData.mediaMainDetails.assets.videos.map((v) => (
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
																() =>
																	"https://www.dailymotion.com/embed/video/",
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
						{!loaderData.userPreferences.watchProvidersDisabled ? (
							<Tabs.Panel value="watchProviders">
								<MediaAdditionalDetailsSuspenseLoader>
									{(mediaAdditionalDetails) =>
										mediaAdditionalDetails.watchProviders.length > 0 ? (
											<MediaScrollArea
												itemDetailsHeight={
													loaderData.coreDetails.itemDetailsHeight
												}
											>
												<Stack gap="sm">
													<Text>
														JustWatch makes it easy to find out where you can
														legally watch your favorite movies & TV shows
														online. Visit{" "}
														<Anchor href={JUSTWATCH_URL}>JustWatch</Anchor> for
														more information.
													</Text>
													<Text>
														The following is a list of all available watch
														providers for this media along with the countries
														they are available in.
													</Text>
													{mediaAdditionalDetails.watchProviders.map(
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
										)
									}
								</MediaAdditionalDetailsSuspenseLoader>
							</Tabs.Panel>
						) : null}
					</Tabs>
				</MediaDetailsLayout>
			</Container>
		</>
	);
}

const UserMetadataDetailsSuspenseLoader = (props: {
	children: (arg: UserMetadataDetailsQuery["userMetadataDetails"]) => ReactNode;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	return (
		<Suspense fallback={<FallbackForDefer />}>
			<Await resolve={loaderData.userMediaDetails}>
				{({ userMetadataDetails }) => props.children(userMetadataDetails)}
			</Await>
		</Suspense>
	);
};

const MediaAdditionalDetailsSuspenseLoader = (props: {
	children: (
		arg: MetadataAdditionalDetailsQuery["metadataDetails"],
	) => ReactNode;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	return (
		<Suspense fallback={<FallbackForDefer />}>
			<Await resolve={loaderData.mediaAdditionalDetails}>
				{({ metadataDetails }) => props.children(metadataDetails)}
			</Await>
		</Suspense>
	);
};

type UpdateProgress = {
	onlySeason?: boolean;
	completeShow?: boolean;
	completePodcast?: boolean;
	showSeasonNumber?: number | null;
	showEpisodeNumber?: number | null;
	podcastEpisodeNumber?: number | null;
};

const WATCH_TIMES = [
	"Just Right Now",
	"I don't remember",
	"Custom Date",
] as const;

const ProgressUpdateModal = (props: {
	opened: boolean;
	onClose: () => void;
	data?: UpdateProgress;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [selectedDate, setSelectedDate] = useState<Date | null | undefined>(
		new Date(),
	);
	const [watchTime, setWatchTime] =
		useState<(typeof WATCH_TIMES)[number]>("Just Right Now");
	const [animeEpisodeNumber, setAnimeEpisodeNumber] = useState<
		string | undefined
	>(undefined);
	const [mangaChapterNumber, setMangaChapterNumber] = useState<
		string | undefined
	>(undefined);

	if (!props.data) return <></>;
	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form
				method="post"
				action="?intent=progressUpdate"
				replace
				onSubmit={() => {
					props.onClose();
					events.updateProgress(loaderData.mediaMainDetails.title);
				}}
			>
				{[
					...Object.entries(props.data),
					["metadataId", loaderData.metadataId.toString()],
					["metadataLot", loaderData.mediaMainDetails.lot.toString()],
				].map(([k, v]) => (
					<Fragment key={k}>
						{typeof v !== "undefined" ? (
							<input hidden name={k} defaultValue={v?.toString()} key={k} />
						) : null}
					</Fragment>
				))}
				{loaderData.query[redirectToQueryParam] ? (
					<input
						hidden
						name={redirectToQueryParam}
						defaultValue={loaderData.query[redirectToQueryParam]}
					/>
				) : null}
				<Stack>
					{loaderData.mediaMainDetails.lot === MediaLot.Anime ? (
						<>
							<NumberInput
								label="Episode"
								name="animeEpisodeNumber"
								description="Leaving this empty will mark the whole anime as watched"
								hideControls
								value={animeEpisodeNumber}
								onChange={(e) => setAnimeEpisodeNumber(e.toString())}
							/>
							{animeEpisodeNumber ? (
								<Checkbox
									label="Mark all episodes before this as watched"
									name="animeAllEpisodesBefore"
								/>
							) : null}
						</>
					) : null}
					{loaderData.mediaMainDetails.lot === MediaLot.Manga ? (
						<>
							<NumberInput
								label="Chapter"
								name="mangaChapterNumber"
								description="Leaving this empty will mark the whole manga as watched"
								hideControls
								value={mangaChapterNumber}
								onChange={(e) => setMangaChapterNumber(e.toString())}
							/>
							{mangaChapterNumber ? (
								<Checkbox
									label="Mark all chapters before this as watched"
									name="mangaAllChaptersBefore"
								/>
							) : null}
						</>
					) : null}
					<MediaAdditionalDetailsSuspenseLoader>
						{(mediaAdditionalDetails) => (
							<>
								{loaderData.mediaMainDetails.lot === MediaLot.Show ? (
									<>
										<input
											hidden
											name="showSpecifics"
											defaultValue={JSON.stringify(
												mediaAdditionalDetails.showSpecifics?.seasons.map(
													(s) => ({
														seasonNumber: s.seasonNumber,
														episodes: s.episodes.map((e) => e.episodeNumber),
													}),
												),
											)}
										/>
										{props.data?.onlySeason || props.data?.completeShow ? (
											<Alert color="yellow" icon={<IconAlertCircle />}>
												{props.data.onlySeason
													? `This will mark all episodes of season ${props.data.showSeasonNumber} as seen`
													: props.data.completeShow
													  ? "This will mark all episodes for this show as seen"
													  : null}
											</Alert>
										) : null}
										{!props.data?.completeShow ? (
											<Select
												label="Season"
												data={mediaAdditionalDetails.showSpecifics?.seasons.map(
													(s) => ({
														label: `${s.seasonNumber}. ${s.name.toString()}`,
														value: s.seasonNumber.toString(),
													}),
												)}
												defaultValue={props.data?.showSeasonNumber?.toString()}
											/>
										) : null}
										{props.data?.onlySeason ? (
											<Checkbox
												label="Mark all seasons before this as seen"
												name="showAllSeasonsBefore"
											/>
										) : null}
										{!props.data?.onlySeason &&
										typeof props.data?.showSeasonNumber !== "undefined" ? (
											<Select
												label="Episode"
												data={
													mediaAdditionalDetails.showSpecifics?.seasons
														.find(
															(s) =>
																s.seasonNumber ===
																Number(props.data?.showSeasonNumber),
														)
														?.episodes.map((e) => ({
															label: `${e.episodeNumber}. ${e.name.toString()}`,
															value: e.episodeNumber.toString(),
														})) || []
												}
												defaultValue={props.data.showEpisodeNumber?.toString()}
											/>
										) : null}
									</>
								) : null}
								{loaderData.mediaMainDetails.lot === MediaLot.Podcast ? (
									<>
										<input
											hidden
											name="podcastSpecifics"
											defaultValue={JSON.stringify(
												mediaAdditionalDetails.podcastSpecifics?.episodes.map(
													(e) => ({
														episodeNumber: e.number,
													}),
												),
											)}
										/>
										{props.data?.completePodcast ? (
											<Alert color="yellow" icon={<IconAlertCircle />}>
												This will mark all episodes for this podcast as seen
											</Alert>
										) : (
											<>
												<Title order={6}>Select episode</Title>
												<Autocomplete
													label="Episode"
													data={mediaAdditionalDetails.podcastSpecifics?.episodes.map(
														(se) => ({
															label: se.title.toString(),
															value: se.number.toString(),
														}),
													)}
													defaultValue={props.data?.podcastEpisodeNumber?.toString()}
												/>
											</>
										)}
									</>
								) : null}
							</>
						)}
					</MediaAdditionalDetailsSuspenseLoader>
					<Select
						label={`When did you ${getVerb(
							Verb.Read,
							loaderData.mediaMainDetails.lot,
						)} it?`}
						data={WATCH_TIMES}
						value={watchTime}
						onChange={(v) => {
							setWatchTime(v as typeof watchTime);
							match(v)
								.with(WATCH_TIMES[0], () => setSelectedDate(new Date()))
								.with(WATCH_TIMES[1], () => setSelectedDate(null))
								.with(WATCH_TIMES[2], () => setSelectedDate(null));
						}}
					/>
					{watchTime === WATCH_TIMES[2] ? (
						<DatePickerInput
							label="Enter exact date"
							dropdownType="modal"
							maxDate={new Date()}
							onChange={setSelectedDate}
							clearable
						/>
					) : null}
					<Select
						label={`Where did you ${getVerb(
							Verb.Read,
							loaderData.mediaMainDetails.lot,
						)} it?`}
						data={loaderData.userPreferences.watchProviders}
						name="providerWatchedOn"
					/>
					<Button
						variant="outline"
						disabled={selectedDate === undefined}
						type="submit"
						name="date"
						value={
							selectedDate ? formatDateToNaiveDate(selectedDate) : undefined
						}
					>
						Submit
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};

const IndividualProgressModal = (props: {
	title: string;
	opened: boolean;
	onClose: () => void;
	metadataId: number;
	progress: number;
	inProgress: UserMetadataDetailsQuery["userMetadataDetails"]["history"][number];
	total?: number | null;
	lot: MediaLot;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [value, setValue] = useState<number | undefined>(props.progress);

	const [updateIcon, text] = match(props.lot)
		.with(MediaLot.Book, () => [<IconBook size={24} />, "Pages"])
		.with(MediaLot.Anime, () => [<IconDeviceTv size={24} />, "Episodes"])
		.with(MediaLot.Manga, () => [<IconBrandPagekit size={24} />, "Chapters"])
		.with(MediaLot.Movie, MediaLot.VisualNovel, MediaLot.AudioBook, () => [
			<IconClock size={24} />,
			"Minutes",
		])
		.otherwise(() => [null, null]);

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
			size="sm"
		>
			<Form
				action="?intent=individualProgressUpdate"
				method="post"
				replace
				onSubmit={() => {
					events.updateProgress(props.title);
				}}
			>
				<input hidden name="metadataId" defaultValue={props.metadataId} />
				<input hidden name="progress" value={value} readOnly />
				<input
					hidden
					name="date"
					defaultValue={formatDateToNaiveDate(new Date())}
				/>
				<Stack>
					<Title order={3}>Set progress</Title>
					<Group>
						<Slider
							showLabelOnHover={false}
							value={value}
							onChange={setValue}
							style={{ flexGrow: 1 }}
						/>
						<NumberInput
							value={value}
							onChange={(v) => {
								if (v) setValue(Number(v));
								else setValue(undefined);
							}}
							max={100}
							min={0}
							step={1}
							w="20%"
							hideControls
							rightSection={<IconPercentage size={16} />}
						/>
					</Group>
					{props.total ? (
						<>
							<Text ta="center" fw="bold">
								OR
							</Text>
							<Flex align="center" gap="xs">
								<NumberInput
									value={((props.total || 1) * (value || 1)) / 100}
									onChange={(v) => {
										const newVal = (Number(v) / (props.total || 1)) * 100;
										setValue(newVal);
									}}
									max={props.total}
									min={0}
									step={1}
									hideControls
									leftSection={updateIcon}
								/>
								<Text>{text}</Text>
							</Flex>
						</>
					) : null}
					<Select
						data={loaderData.userPreferences.watchProviders}
						label={`Where did you ${getVerb(
							Verb.Read,
							loaderData.mediaMainDetails.lot,
						)} it?`}
						name="providerWatchedOn"
						defaultValue={props.inProgress.providerWatchedOn}
					/>
					<Button variant="outline" type="submit" onClick={props.onClose}>
						Update
					</Button>
					<Button variant="outline" color="red" onClick={props.onClose}>
						Cancel
					</Button>
				</Stack>
			</Form>
		</Modal>
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

const AdjustSeenTimesModal = (props: {
	opened: boolean;
	onClose: () => void;
	seenId: number;
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
	metadataId: number;
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
					<NumberInput label="Destination media ID" name="mergeInto" required />
					<Button type="submit" onClick={props.onClose}>
						Submit
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};

const AccordionLabel = (props: {
	name: string;
	id?: number | null;
	numEpisodes?: number | null;
	posterImages: string[];
	overview?: string | null;
	children: ReactNode;
	displayIndicator: number;
	runtime?: number | null;
	publishDate?: string | null;
}) => {
	const display = [
		props.runtime ? humanizeDuration(props.runtime * 1000 * 60) : null,
		props.publishDate ? dayjsLib(props.publishDate).format("ll") : null,
		props.numEpisodes ? `${props.numEpisodes} episodes` : null,
	]
		.filter(Boolean)
		.join("; ");

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
						disabled={props.displayIndicator === 0}
						label={
							props.displayIndicator === 1
								? "Seen"
								: `Seen × ${props.displayIndicator}`
						}
						offset={7}
						position="bottom-end"
						size={16}
						color="red"
					>
						<Avatar
							src={props.posterImages[0]}
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
			{props.overview ? (
				<Text
					size="sm"
					c="dimmed"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
					dangerouslySetInnerHTML={{ __html: props.overview }}
				/>
			) : null}
		</Stack>
	);
};

type History =
	UserMetadataDetailsQuery["userMetadataDetails"]["history"][number];
type ShowSpecifics =
	MetadataAdditionalDetailsQuery["metadataDetails"]["showSpecifics"];
type PodcastSpecifics =
	MetadataAdditionalDetailsQuery["metadataDetails"]["podcastSpecifics"];

const SeenItem = (props: {
	history: History;
	showSpecifics?: ShowSpecifics;
	podcastSpecifics?: PodcastSpecifics;
}) => {
	const [opened, { open, close }] = useDisclosure(false);
	const showExtraInformation = props.history.showExtraInformation
		? props.showSpecifics?.seasons
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
		? props.podcastSpecifics?.episodes.find(
				(e) => e.number === props.history.podcastExtraInformation?.episode,
		  )
		: null;
	const displayPodcastExtraInformation = podcastExtraInformation
		? `EP-${props.history.podcastExtraInformation?.episode}: ${podcastExtraInformation.title}`
		: null;
	const displayAnimeExtraInformation =
		props.history.animeExtraInformation?.episode;
	const displayMangaExtraInformation =
		props.history.mangaExtraInformation?.chapter;
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

	return (
		<>
			<Flex
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
					<SimpleGrid cols={{ base: 1, md: 2 }} spacing={2}>
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
						{props.history.totalTimeSpent ? (
							<Flex gap="xs">
								<Text size="sm">Time:</Text>
								<Text size="sm" fw="bold">
									{humanizeDuration(props.history.totalTimeSpent * 1000, {
										round: true,
										units: ["mo", "d", "h"],
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

const FallbackForDefer = () => (
	<>
		<Skeleton height={16} />
	</>
);
