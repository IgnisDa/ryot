import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Alert,
	Anchor,
	Autocomplete,
	Avatar,
	Box,
	Button,
	Center,
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
	Pagination,
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
import { DateInput, DatePickerInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import {
	redirect,
	unstable_defineAction,
	unstable_defineLoader,
} from "@remix-run/node";
import {
	Form,
	Link,
	type MetaArgs_SingleFetch,
	useActionData,
	useLoaderData,
} from "@remix-run/react";
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
import { useQuery } from "@tanstack/react-query";
import type { HumanizeDurationOptions } from "humanize-duration-ts";
import { Fragment, type ReactNode, useState } from "react";
import { GroupedVirtuoso, Virtuoso } from "react-virtuoso";
import { namedAction } from "remix-utils/named-action";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import {
	AddEntityToCollectionModal,
	MEDIA_DETAILS_HEIGHT,
	MediaDetailsLayout,
} from "~/components/common";
import {
	DisplayCollection,
	MediaIsPartial,
	MediaScrollArea,
	PartialMetadataDisplay,
	type PostReview,
	PostReviewModal,
	ReviewItemDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import events from "~/lib/events";
import {
	Verb,
	clientGqlService,
	dayjsLib,
	getVerb,
	redirectToQueryParam,
} from "~/lib/generals";
import { useGetMantineColor } from "~/lib/hooks";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getCoreDetails,
	getUserCollectionsList,
	getUserDetails,
	getUserPreferences,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";
import {
	MetadataSpecificsSchema,
	processSubmission,
} from "~/lib/utilities.server";

const JUST_WATCH_URL = "https://www.justwatch.com";

const searchParamsSchema = z
	.object({
		defaultTab: z.string().optional(),
		openProgressModal: zx.BoolAsString.optional(),
		openReviewModal: zx.BoolAsString.optional(),
		[redirectToQueryParam]: z.string().optional(),
	})
	.merge(MetadataSpecificsSchema);

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const metadataId = params.id;
	invariant(metadataId, "No ID provided");
	const [
		coreDetails,
		userPreferences,
		userDetails,
		{ metadataDetails: mediaMainDetails },
		collections,
		{ userMetadataDetails },
	] = await Promise.all([
		getCoreDetails(request),
		getUserPreferences(request),
		getUserDetails(request),
		serverGqlService.request(MetadataMainDetailsDocument, { metadataId }),
		getUserCollectionsList(request),
		serverGqlService.request(
			UserMetadataDetailsDocument,
			{ input: { metadataId, seenPage: 1 } },
			await getAuthorizationHeader(request),
		),
	]);
	return {
		query,
		coreDetails: { pageLimit: coreDetails.pageLimit },
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
		userDetails,
		metadataId,
		mediaMainDetails,
		collections,
		userMetadataDetails,
	};
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.mediaMainDetails.title} | Ryot` }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		individualProgressUpdate: async () => {
			const submission = processSubmission(formData, bulkUpdateSchema);
			await serverGqlService.request(
				DeployBulkProgressUpdateDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			return Response.json({ status: "success", tt: new Date() } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Progress updated successfully",
				}),
			});
		},
		deleteSeenItem: async () => {
			const submission = processSubmission(formData, seenIdSchema);
			await serverGqlService.request(
				DeleteSeenItemDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return Response.json({ status: "success", tt: new Date() } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Record deleted successfully",
				}),
			});
		},
		deployUpdateMetadataJob: async () => {
			const submission = processSubmission(formData, metadataIdSchema);
			await serverGqlService.request(
				DeployUpdateMetadataJobDocument,
				submission,
				await getAuthorizationHeader(request),
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
				await getAuthorizationHeader(request),
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
				await getAuthorizationHeader(request),
			);
			return Response.json({ status: "success", tt: new Date() } as const, {
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
				mangaVolumeNumber: submission.mangaVolumeNumber,
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
			const { deployBulkProgressUpdate } = await serverGqlService.request(
				DeployBulkProgressUpdateDocument,
				{ input: updates },
				await getAuthorizationHeader(request),
			);
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
			return Response.json(
				{ status: "success", tt: new Date() } as const,
				headers,
			);
		},
	});
});

const metadataIdSchema = z.object({ metadataId: z.string() });

const bulkUpdateSchema = z
	.object({
		progress: z.string().optional(),
		date: z.string().optional(),
		changeState: z.nativeEnum(SeenState).optional(),
		providerWatchedOn: z.string().optional(),
	})
	.merge(MetadataSpecificsSchema)
	.merge(metadataIdSchema);

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

const useMetadataAdditionalDetails = () => {
	const loaderData = useLoaderData<typeof loader>();
	const { data } = useQuery({
		queryKey: ["metadataAdditionalDetails", loaderData.metadataId],
		queryFn: async () => {
			const { metadataDetails } = await clientGqlService.request(
				MetadataAdditionalDetailsDocument,
				{ metadataId: loaderData.metadataId },
			);
			return metadataDetails;
		},
		staleTime: Number.POSITIVE_INFINITY,
	});
	return data;
};

const useUserMetadataDetails = (
	initialData: UserMetadataDetailsQuery["userMetadataDetails"],
	seenPage: number,
) => {
	const loaderData = useLoaderData<typeof loader>();
	const actionData = useActionData<typeof action>();
	const { data } = useQuery({
		queryKey: [
			"userMetadataDetails",
			loaderData.metadataId,
			seenPage,
			actionData,
		],
		queryFn: async () => {
			const { userMetadataDetails } = await clientGqlService.request(
				UserMetadataDetailsDocument,
				{ input: { metadataId: loaderData.metadataId, seenPage } },
			);
			return userMetadataDetails;
		},
		initialData,
	});
	return data;
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const getMantineColor = useGetMantineColor();
	const metadataAdditionalDetails = useMetadataAdditionalDetails();
	const [activeSeenPage, setActiveSeenPage] = useState(1);
	const userMetadataDetails = useUserMetadataDetails(
		loaderData.userMetadataDetails,
		activeSeenPage,
	);
	const [tab, setTab] = useState<string | null>(
		loaderData.query.defaultTab || "overview",
	);
	const [
		progressModalOpened,
		{ open: progressModalOpen, close: progressModalClose },
	] = useDisclosure(false);
	const [
		collectionModalOpened,
		{ open: collectionModalOpen, close: collectionModalClose },
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

	const totalSeenPages =
		userMetadataDetails.seenByUserCount / loaderData.coreDetails.pageLimit;

	return (
		<>
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
				objectId={loaderData.metadataId.toString()}
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
					{userMetadataDetails.collections.length > 0 ? (
						<Group>
							{userMetadataDetails.collections.map((col) => (
								<DisplayCollection
									key={col.id}
									col={col}
									userId={col.userId}
									entityId={loaderData.metadataId.toString()}
									entityLot={EntityLot.Media}
								/>
							))}
						</Group>
					) : null}
					{loaderData.mediaMainDetails.isPartial ? (
						<MediaIsPartial mediaType="media" />
					) : null}
					<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
						{[
							loaderData.mediaMainDetails.publishDate
								? dayjsLib(loaderData.mediaMainDetails.publishDate).format("LL")
								: loaderData.mediaMainDetails.publishYear,
							loaderData.mediaMainDetails.originalLanguage,
							loaderData.mediaMainDetails.productionStatus,
							metadataAdditionalDetails?.bookSpecifics?.pages &&
								`${metadataAdditionalDetails.bookSpecifics.pages} pages`,
							metadataAdditionalDetails?.podcastSpecifics?.totalEpisodes &&
								`${metadataAdditionalDetails.podcastSpecifics.totalEpisodes} episodes`,
							metadataAdditionalDetails?.animeSpecifics?.episodes &&
								`${metadataAdditionalDetails.animeSpecifics.episodes} episodes`,
							metadataAdditionalDetails?.mangaSpecifics?.chapters &&
								`${metadataAdditionalDetails.mangaSpecifics.chapters} chapters`,
							metadataAdditionalDetails?.mangaSpecifics?.volumes &&
								`${metadataAdditionalDetails.mangaSpecifics.volumes} volumes`,
							metadataAdditionalDetails?.movieSpecifics?.runtime &&
								humanizeDuration(
									metadataAdditionalDetails.movieSpecifics.runtime * 1000 * 60,
								),
							metadataAdditionalDetails?.showSpecifics?.totalSeasons &&
								`${metadataAdditionalDetails.showSpecifics.totalSeasons} seasons`,
							metadataAdditionalDetails?.showSpecifics?.totalEpisodes &&
								`${metadataAdditionalDetails.showSpecifics.totalEpisodes} episodes`,
							metadataAdditionalDetails?.showSpecifics?.runtime &&
								humanizeDuration(
									metadataAdditionalDetails.showSpecifics.runtime * 1000 * 60,
								),
							metadataAdditionalDetails?.audioBookSpecifics?.runtime &&
								humanizeDuration(
									metadataAdditionalDetails.audioBookSpecifics.runtime *
										1000 *
										60,
								),
						]
							.filter(Boolean)
							.join(" • ")}
					</Text>
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
										{Number(loaderData.mediaMainDetails.providerRating).toFixed(
											1,
										)}
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
									<IconStarFilled size={22} style={{ color: "#EBE600FF" }} />
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
					{userMetadataDetails?.inProgress ? (
						<Alert icon={<IconAlertCircle />} variant="outline">
							You are currently{" "}
							{getVerb(Verb.Read, loaderData.mediaMainDetails.lot)}
							ing this (
							{Number(userMetadataDetails.inProgress.progress).toFixed(2)}
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
							{loaderData.mediaMainDetails.lot === MediaLot.Show ? (
								<Tabs.Tab
									value="showSeasons"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Seasons
								</Tabs.Tab>
							) : null}
							{loaderData.mediaMainDetails.lot === MediaLot.Podcast ? (
								<Tabs.Tab
									value="podcastEpisodes"
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
							<MediaScrollArea>
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
											{loaderData.mediaMainDetails.creators.map((c) => (
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
									{userMetadataDetails.inProgress ? (
										<IndividualProgressModal
											title={loaderData.mediaMainDetails.title}
											progress={Number(userMetadataDetails.inProgress.progress)}
											inProgress={userMetadataDetails.inProgress}
											metadataId={loaderData.metadataId}
											onClose={progressModalClose}
											opened={progressModalOpened}
											lot={loaderData.mediaMainDetails.lot}
											total={
												metadataAdditionalDetails?.audioBookSpecifics
													?.runtime ||
												metadataAdditionalDetails?.bookSpecifics?.pages ||
												metadataAdditionalDetails?.movieSpecifics?.runtime ||
												metadataAdditionalDetails?.mangaSpecifics?.chapters ||
												metadataAdditionalDetails?.animeSpecifics?.episodes ||
												metadataAdditionalDetails?.visualNovelSpecifics?.length
											}
										/>
									) : null}
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
																				? userMetadataDetails.nextEntry?.season
																				: undefined,
																		showEpisodeNumber:
																			loaderData.mediaMainDetails.lot ===
																			MediaLot.Show
																				? userMetadataDetails.nextEntry?.episode
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
													{userMetadataDetails.history.length !== 0 ? (
														<DropBtn />
													) : (
														<Menu.Item disabled>
															No history. Update from the seasons tab.
														</Menu.Item>
													)}
												</>
											) : null}
											{loaderData.mediaMainDetails.lot === MediaLot.Podcast ? (
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
																				? userMetadataDetails.nextEntry?.episode
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
													{userMetadataDetails.history.length !== 0 ? (
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
													<Menu.Item onClick={progressModalOpen}>
														Set progress
													</Menu.Item>
													{loaderData.mediaMainDetails.lot !== MediaLot.Show &&
													loaderData.mediaMainDetails.lot !==
														MediaLot.Podcast ? (
														<StateChangeButtons />
													) : null}
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
											) : loaderData.mediaMainDetails.lot !== MediaLot.Show &&
												loaderData.mediaMainDetails.lot !== MediaLot.Podcast ? (
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
														<input hidden name="progress" defaultValue={0} />
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
														userMetadataDetails?.nextEntry?.season ?? undefined,
													showEpisodeNumber:
														loaderData.mediaMainDetails.lot === MediaLot.Show
															? userMetadataDetails?.nextEntry?.episode ??
																undefined
															: null,
													podcastEpisodeNumber:
														loaderData.mediaMainDetails.lot === MediaLot.Podcast
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
											userId={loaderData.userDetails.id}
											onClose={collectionModalClose}
											opened={collectionModalOpened}
											entityId={loaderData.metadataId.toString()}
											entityLot={EntityLot.Media}
											collections={loaderData.collections}
										/>
									</>
									<Menu shadow="md">
										<Menu.Target>
											<Button variant="outline">More actions</Button>
										</Menu.Target>
										<Menu.Dropdown>
											<ToggleMediaMonitorMenuItem
												userId={loaderData.userDetails.id}
												inCollections={userMetadataDetails.collections.map(
													(c) => c.name,
												)}
												formValue={loaderData.metadataId}
												entityLot={EntityLot.Media}
											/>
											{loaderData.mediaMainDetails.source !==
											MediaSource.Custom ? (
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
											) : null}
											<Menu.Item onClick={mergeMetadataModalOpen}>
												Merge media
											</Menu.Item>
										</Menu.Dropdown>
									</Menu>
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="history">
							{userMetadataDetails.seenByAllCount > 0 ||
							userMetadataDetails.seenByUserCount > 0 ||
							userMetadataDetails.unitsConsumed ? (
								<MediaScrollArea>
									<Stack>
										<Box>
											<Text fz={{ base: "sm", md: "md" }}>
												Seen by all users {userMetadataDetails.seenByAllCount}{" "}
												time
												{userMetadataDetails.seenByAllCount > 1 ? "s" : ""} and{" "}
												{userMetadataDetails.seenByUserCount} time
												{userMetadataDetails &&
												userMetadataDetails.seenByUserCount > 1
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
																	(userMetadataDetails.unitsConsumed || 0) *
																		1000 *
																		60,
																),
														)
														.otherwise(
															(v) =>
																`${userMetadataDetails.unitsConsumed} ${match(v)
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
										{userMetadataDetails.history.map((history) => (
											<SeenItem
												history={history}
												key={history.id}
												showSpecifics={metadataAdditionalDetails?.showSpecifics}
												podcastSpecifics={
													metadataAdditionalDetails?.podcastSpecifics
												}
											/>
										))}
										{totalSeenPages > 1 ? (
											<Center>
												<Pagination
													total={totalSeenPages}
													value={activeSeenPage}
													onChange={setActiveSeenPage}
													color="grape"
													size="xs"
												/>
											</Center>
										) : undefined}
									</Stack>
								</MediaScrollArea>
							) : (
								<Text>No history</Text>
							)}
						</Tabs.Panel>
						<Tabs.Panel value="showSeasons">
							{metadataAdditionalDetails?.showSpecifics &&
							userMetadataDetails.showProgress ? (
								<Box h={MEDIA_DETAILS_HEIGHT}>
									<GroupedVirtuoso
										groupCounts={metadataAdditionalDetails.showSpecifics.seasons.map(
											(season) => season.episodes.length,
										)}
										groupContent={(index) => (
											<DisplayShowSeason
												seasonIdx={index}
												setData={setUpdateProgressModalData}
												showProgress={userMetadataDetails.showProgress}
											/>
										)}
										itemContent={(index, groupIndex) => (
											<DisplayShowEpisode
												overallIdx={index}
												seasonIdx={groupIndex}
												setData={setUpdateProgressModalData}
												seasonProgress={userMetadataDetails.showProgress}
												seasonNumber={
													// biome-ignore lint/style/noNonNullAssertion: typescript error
													metadataAdditionalDetails.showSpecifics!.seasons[
														groupIndex
													].seasonNumber
												}
											/>
										)}
									/>
								</Box>
							) : undefined}
						</Tabs.Panel>
						{metadataAdditionalDetails?.podcastSpecifics ? (
							<Tabs.Panel value="podcastEpisodes" h={MEDIA_DETAILS_HEIGHT}>
								<Virtuoso
									style={{ height: "100%" }}
									data={metadataAdditionalDetails.podcastSpecifics.episodes}
									itemContent={(podcastEpisodeIdx, podcastEpisode) => (
										<DisplayPodcastEpisode
											key={podcastEpisode.id}
											episode={podcastEpisode}
											index={podcastEpisodeIdx}
											setData={setUpdateProgressModalData}
											podcastProgress={userMetadataDetails.podcastProgress}
										/>
									)}
								/>
							</Tabs.Panel>
						) : undefined}
						{!loaderData.userPreferences.disableReviews ? (
							<Tabs.Panel value="reviews">
								{userMetadataDetails.reviews.length > 0 ? (
									<MediaScrollArea>
										<Stack>
											{userMetadataDetails.reviews.map((r) => (
												<ReviewItemDisplay
													entityType="metadata"
													review={r}
													key={r.id}
													metadataId={loaderData.metadataId}
													reviewScale={loaderData.userPreferences.reviewScale}
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
						<Tabs.Panel value="suggestions">
							{loaderData.mediaMainDetails.suggestions.length > 0 ? (
								<MediaScrollArea>
									<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
										{loaderData.mediaMainDetails.suggestions.map((sug) => (
											<PartialMetadataDisplay
												key={sug.identifier}
												media={sug}
											/>
										))}
									</SimpleGrid>
								</MediaScrollArea>
							) : (
								<Text>No suggestions</Text>
							)}
						</Tabs.Panel>
						{!loaderData.userPreferences.videosDisabled ? (
							<Tabs.Panel value="videos">
								<MediaScrollArea>
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
								{loaderData.mediaMainDetails.watchProviders.length > 0 ? (
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
											{loaderData.mediaMainDetails.watchProviders.map(
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
	const metadataAdditionalDetails = useMetadataAdditionalDetails();
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
	const [mangaVolumeNumber, setMangaVolumeNumber] = useState<
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
							<Box>
								<Text c="dimmed" size="sm">
									Leaving the following empty will mark the whole manga as
									watched
								</Text>
								<Group wrap="nowrap">
									<NumberInput
										label="Chapter"
										name="mangaChapterNumber"
										hideControls
										value={mangaChapterNumber}
										onChange={(e) => setMangaChapterNumber(e.toString())}
									/>
									<Text ta="center" fw="bold" mt="sm">
										OR
									</Text>
									<NumberInput
										label="Volume"
										name="mangaVolumeNumber"
										hideControls
										value={mangaVolumeNumber}
										onChange={(e) => setMangaVolumeNumber(e.toString())}
									/>
								</Group>
							</Box>
							{mangaChapterNumber ? (
								<Checkbox
									label="Mark all chapters before this as watched"
									name="mangaAllChaptersBefore"
								/>
							) : null}
						</>
					) : null}
					{loaderData.mediaMainDetails.lot === MediaLot.Show ? (
						<>
							<input
								hidden
								name="showSpecifics"
								defaultValue={JSON.stringify(
									metadataAdditionalDetails?.showSpecifics?.seasons.map(
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
									data={metadataAdditionalDetails?.showSpecifics?.seasons.map(
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
										metadataAdditionalDetails?.showSpecifics?.seasons
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
									metadataAdditionalDetails?.podcastSpecifics?.episodes.map(
										(e) => ({ episodeNumber: e.number }),
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
										data={metadataAdditionalDetails?.podcastSpecifics?.episodes.map(
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

type AllUserHistory =
	UserMetadataDetailsQuery["userMetadataDetails"]["history"];

const IndividualProgressModal = (props: {
	title: string;
	opened: boolean;
	onClose: () => void;
	metadataId: string;
	progress: number;
	inProgress: AllUserHistory[number];
	total?: number | null;
	lot: MediaLot;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [value, setValue] = useState<number | undefined>(props.progress);

	const [updateIcon, text] = match(props.lot)
		.with(MediaLot.Book, () => [<IconBook size={24} key="element" />, "Pages"])
		.with(MediaLot.Anime, () => [
			<IconDeviceTv size={24} key="element" />,
			"Episodes",
		])
		.with(MediaLot.Manga, () => [
			<IconBrandPagekit size={24} key="element" />,
			"Chapters",
		])
		.with(MediaLot.Movie, MediaLot.VisualNovel, MediaLot.AudioBook, () => [
			<IconClock size={24} key="element" />,
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
									defaultValue={((props.total || 1) * (value || 1)) / 100}
									onChange={(v) => {
										const value = (Number(v) / (props.total || 1)) * 100;
										setValue(value);
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
	id?: number | string | null;
	numEpisodes?: number | null;
	posterImages: Array<string>;
	overview?: string | null;
	children: ReactNode;
	displayIndicator: number;
	runtime?: number | null;
	publishDate?: string | null;
}) => {
	const display = [
		props.runtime
			? humanizeDuration(props.runtime * 1000 * 60, { units: ["h", "m"] })
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
	const isLessThanAnHour = timeSpentInMilliseconds < 1000 * 60 * 60;
	if (isLessThanAnHour) units?.push("m");

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
	setData: (data: UpdateProgress) => void;
	showProgress: UserMetadataDetailsQuery["userMetadataDetails"]["showProgress"];
	seasonIdx: number;
}) => {
	const metadataAdditionalDetails = useMetadataAdditionalDetails();
	const season =
		metadataAdditionalDetails?.showSpecifics?.seasons[props.seasonIdx];
	const isSeen = (props.showProgress?.[props.seasonIdx]?.timesSeen || 0) > 0;

	invariant(season, "Season not found");

	return (
		<Box my="xs">
			<DisplaySeasonOrEpisodeDetails
				{...season}
				name={`${season.seasonNumber}. ${season.name}`}
				numEpisodes={season.episodes.length}
				displayIndicator={isSeen ? 1 : 0}
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
								props.setData({
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
		</Box>
	);
};

const DisplayShowEpisode = (props: {
	overallIdx: number;
	seasonIdx: number;
	seasonNumber: number;
	seasonProgress: UserMetadataDetailsQuery["userMetadataDetails"]["showProgress"];
	setData: (data: UpdateProgress) => void;
}) => {
	const metadataAdditionalDetails = useMetadataAdditionalDetails();
	const flattenedEpisodes =
		metadataAdditionalDetails?.showSpecifics?.seasons.flatMap(
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
			>
				<Button
					variant={numTimesEpisodeSeen > 0 ? "default" : "outline"}
					color="blue"
					onClick={() => {
						props.setData({
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
	setData: (data: UpdateProgress) => void;
	podcastProgress: UserMetadataDetailsQuery["userMetadataDetails"]["podcastProgress"];
}) => {
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
						props.setData({ podcastEpisodeNumber: props.episode.number });
					}}
				>
					{numTimesEpisodeSeen > 0 ? "Re-listen this" : "Mark as listened"}
				</Button>
			</DisplaySeasonOrEpisodeDetails>
		</Box>
	);
};
