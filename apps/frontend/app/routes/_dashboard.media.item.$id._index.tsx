import { $path } from "@ignisda/remix-routes";
import {
	Accordion,
	ActionIcon,
	Alert,
	Anchor,
	Avatar,
	Box,
	Button,
	Container,
	Flex,
	Group,
	Image,
	Indicator,
	Menu,
	Modal,
	NumberInput,
	Paper,
	ScrollArea,
	SimpleGrid,
	Slider,
	Stack,
	Tabs,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import "@mantine/dates/styles.css";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import {
	CreateMediaReminderDocument,
	DeleteMediaReminderDocument,
	DeleteSeenItemDocument,
	DeployBulkProgressUpdateDocument,
	DeployUpdateMetadataJobDocument,
	EditSeenItemDocument,
	EntityLot,
	MediaAdditionalDetailsDocument,
	MediaMainDetailsDocument,
	MergeMetadataDocument,
	MetadataLot,
	MetadataSource,
	MetadataVideoSource,
	SeenState,
	ToggleMediaMonitorDocument,
	ToggleMediaOwnershipDocument,
	UserCollectionsListDocument,
	UserMediaDetailsDocument,
	UserMediaDetailsQuery,
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
	IconPercentage,
	IconPlayerPlay,
	IconRotateClockwise,
	IconStarFilled,
	IconUser,
	IconVideo,
	IconX,
} from "@tabler/icons-react";
import { ReactNode, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { MediaDetailsLayout } from "~/components/common";
import {
	AddEntityToCollectionModal,
	DisplayCollection,
	MediaScrollArea,
	PartialMetadataDisplay,
	ReviewItemDisplay,
} from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { Verb, dayjsLib, getVerb } from "~/lib/generals";
import {
	getCoreDetails,
	getUserDetails,
	getUserPreferences,
} from "~/lib/graphql.server";
import { useGetMantineColor } from "~/lib/hooks";
import { createToastHeaders, redirectWithToast } from "~/lib/toast.server";
import {
	ShowAndPodcastSchema,
	processSubmission,
} from "~/lib/utilities.server";

const searchParamsSchema = z
	.object({
		defaultTab: z.string().optional().default("overview"),
	})
	.merge(ShowAndPodcastSchema);

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const id = params.id;
	invariant(id, "No ID provided");
	const metadataId = parseInt(id);
	const [
		coreDetails,
		userPreferences,
		userDetails,
		{ mediaDetails: mediaMainDetails },
		{ mediaDetails: mediaAdditionalDetails },
		{ userMediaDetails },
		{ userCollectionsList: collections },
	] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
		getUserDetails(request),
		gqlClient.request(MediaMainDetailsDocument, { metadataId }),
		gqlClient.request(MediaAdditionalDetailsDocument, { metadataId }),
		gqlClient.request(
			UserMediaDetailsDocument,
			{ metadataId },
			await getAuthorizationHeader(request),
		),
		gqlClient.request(
			UserCollectionsListDocument,
			{},
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		query,
		userPreferences: { reviewScale: userPreferences.general.reviewScale },
		coreDetails: {
			itemDetailsHeight: coreDetails.itemDetailsHeight,
			reviewsDisabled: coreDetails.reviewsDisabled,
			videosDisabled: coreDetails.videosDisabled,
		},
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

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		progressUpdate: async () => {
			const submission = processSubmission(formData, bulkUpdateSchema);
			await gqlClient.request(
				DeployBulkProgressUpdateDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			await new Promise((resolve) => setTimeout(resolve, 1000));
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Progress updated successfully",
				}),
			});
		},
		deleteMediaReminder: async () => {
			const submission = processSubmission(formData, metadataIdSchema);
			await gqlClient.request(
				DeleteMediaReminderDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Reminder deleted successfully",
				}),
			});
		},
		toggleMediaMonitor: async () => {
			const submission = processSubmission(formData, metadataIdSchema);
			await gqlClient.request(
				ToggleMediaMonitorDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Monitor toggled successfully",
				}),
			});
		},
		toggleMediaOwnership: async () => {
			const submission = processSubmission(formData, metadataIdSchema);
			await gqlClient.request(
				ToggleMediaOwnershipDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Ownership toggled successfully",
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
				{ message: "Metadata merged successfully" },
			);
		},
		createMediaReminder: async () => {
			const submission = processSubmission(formData, createMediaReminderSchema);
			const { createMediaReminder } = await gqlClient.request(
				CreateMediaReminderDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: !createMediaReminder ? "error" : undefined,
					message: !createMediaReminder
						? "Reminder was not created"
						: "Reminder created successfully",
				}),
			});
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
					message: "Adjusted seen item successfully",
				}),
			});
		},
	});
};

const metadataIdSchema = z.object({ metadataId: zx.IntAsString });

const bulkUpdateSchema = z
	.object({
		progress: zx.IntAsString.optional(),
		date: z.string().optional(),
		changeState: z.nativeEnum(SeenState).optional(),
	})
	.merge(ShowAndPodcastSchema)
	.merge(metadataIdSchema);

const seenIdSchema = z.object({ seenId: zx.IntAsString });

const createMediaReminderSchema = z
	.object({
		message: z.string(),
		remindOn: z.string(),
	})
	.merge(metadataIdSchema);

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

	const PutOnHoldBtn = () => {
		return (
			<Form action="?intent=progressUpdate" method="post">
				<input hidden name="metadataId" defaultValue={loaderData.metadataId} />
				<input hidden name="changeState" defaultValue={SeenState.OnAHold} />
				<Menu.Item type="submit">Put on hold</Menu.Item>
			</Form>
		);
	};
	const DropBtn = () => {
		return (
			<Form action="?intent=progressUpdate" method="post">
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
				metadataId={loaderData.metadataId}
				title={loaderData.mediaMainDetails.title}
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
			<Container>
				<MediaDetailsLayout
					images={loaderData.mediaAdditionalDetails.assets.images}
					externalLink={{
						source: loaderData.mediaMainDetails.source,
						lot: loaderData.mediaMainDetails.lot,
						href: loaderData.mediaMainDetails.sourceUrl,
					}}
				>
					<Box>
						{loaderData.mediaMainDetails.group ? (
							<Link
								to={$path("/media/groups/:id", {
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
						<Group>
							<Title id="media-title">
								{loaderData.mediaMainDetails.title}
							</Title>
						</Group>
					</Box>
					{loaderData.userMediaDetails.collections.length > 0 ? (
						<Group id="entity-collections">
							{loaderData.userMediaDetails.collections.map((col) => (
								<DisplayCollection
									col={col}
									entityId={loaderData.metadataId.toString()}
									entityLot={EntityLot.Media}
									key={col.id}
								/>
							))}
						</Group>
					) : null}
					<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
						{[
							loaderData.mediaMainDetails.publishDate
								? dayjsLib(loaderData.mediaMainDetails.publishDate).format("LL")
								: loaderData.mediaMainDetails.publishYear,
							loaderData.mediaMainDetails.originalLanguage,
							loaderData.mediaMainDetails.productionStatus,
							loaderData.mediaAdditionalDetails.bookSpecifics?.pages &&
								`${loaderData.mediaAdditionalDetails.bookSpecifics.pages} pages`,
							loaderData.mediaAdditionalDetails.podcastSpecifics
								?.totalEpisodes &&
								`${loaderData.mediaAdditionalDetails.podcastSpecifics.totalEpisodes} episodes`,
							loaderData.mediaAdditionalDetails.animeSpecifics?.episodes &&
								`${loaderData.mediaAdditionalDetails.animeSpecifics.episodes} episodes`,
							loaderData.mediaAdditionalDetails.mangaSpecifics?.chapters &&
								`${loaderData.mediaAdditionalDetails.mangaSpecifics.chapters} chapters`,
							loaderData.mediaAdditionalDetails.mangaSpecifics?.volumes &&
								`${loaderData.mediaAdditionalDetails.mangaSpecifics.volumes} volumes`,
							loaderData.mediaAdditionalDetails.movieSpecifics?.runtime &&
								`${humanizeDuration(
									loaderData.mediaAdditionalDetails.movieSpecifics.runtime *
										1000 *
										60,
								)}`,
							loaderData.mediaAdditionalDetails.showSpecifics?.seasons &&
								`${loaderData.mediaAdditionalDetails.showSpecifics.seasons.length} seasons`,
							loaderData.mediaAdditionalDetails.audioBookSpecifics?.runtime &&
								`${humanizeDuration(
									loaderData.mediaAdditionalDetails.audioBookSpecifics.runtime *
										1000 *
										60,
								)}`,
						]
							.filter(Boolean)
							.join(" • ")}
					</Text>
					{loaderData.mediaMainDetails.providerRating ||
					loaderData.userMediaDetails.averageRating ? (
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
											.with(MetadataSource.Anilist, () => "anilist.svg")
											.with(MetadataSource.Audible, () => "audible.svg")
											.with(
												MetadataSource.GoogleBooks,
												() => "google-books.svg",
											)
											.with(MetadataSource.Igdb, () => "igdb.svg")
											.with(MetadataSource.Itunes, () => "itunes.svg")
											.with(
												MetadataSource.Listennotes,
												() => "listennotes.webp",
											)
											.with(MetadataSource.Mal, () => "mal.svg")
											.with(
												MetadataSource.MangaUpdates,
												() => "manga-updates.svg",
											)
											.with(MetadataSource.Openlibrary, () => "openlibrary.svg")
											.with(MetadataSource.Tmdb, () => "tmdb.svg")
											.with(MetadataSource.Vndb, () => "vndb.ico")
											.with(MetadataSource.Custom, () => undefined)
											.exhaustive()}`}
									/>
									<Text fz="sm">
										{Number(loaderData.mediaMainDetails.providerRating).toFixed(
											1,
										)}
										{match(loaderData.mediaMainDetails.source)
											.with(
												MetadataSource.Anilist,
												MetadataSource.Igdb,
												MetadataSource.Listennotes,
												MetadataSource.Tmdb,
												MetadataSource.Vndb,
												() => "%",
											)
											.with(
												MetadataSource.Audible,
												MetadataSource.GoogleBooks,
												() => "/5",
											)
											.with(
												MetadataSource.Mal,
												MetadataSource.MangaUpdates,
												() => "/10",
											)
											.with(
												MetadataSource.Custom,
												MetadataSource.Itunes,
												MetadataSource.Openlibrary,
												() => undefined,
											)
											.exhaustive()}
									</Text>
								</Paper>
							) : null}
							{loaderData.userMediaDetails.averageRating ? (
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
										{Number(loaderData.userMediaDetails.averageRating).toFixed(
											1,
										)}
										{loaderData.userPreferences.reviewScale ===
										UserReviewScale.OutOfFive
											? undefined
											: "%"}
									</Text>
								</Paper>
							) : null}
						</Group>
					) : null}
					{loaderData.userMediaDetails?.reminder ? (
						<Alert icon={<IconAlertCircle />} variant="outline" color="violet">
							Reminder for {loaderData.userMediaDetails.reminder.remindOn}
							<Text c="green">
								{loaderData.userMediaDetails.reminder.message}
							</Text>
						</Alert>
					) : null}
					{loaderData.userMediaDetails?.inProgress ? (
						<Alert icon={<IconAlertCircle />} variant="outline">
							You are currently{" "}
							{getVerb(Verb.Read, loaderData.mediaMainDetails.lot)}
							ing this ({loaderData.userMediaDetails.inProgress.progress}%)
						</Alert>
					) : null}
					<Tabs variant="outline" defaultValue={loaderData.query.defaultTab}>
						<Tabs.List mb="xs">
							{loaderData.mediaMainDetails.description ||
							loaderData.mediaAdditionalDetails.creators.length > 0 ||
							loaderData.mediaMainDetails.genres.length > 0 ? (
								<Tabs.Tab
									value="overview"
									leftSection={<IconInfoCircle size={16} />}
								>
									Overview
								</Tabs.Tab>
							) : null}
							<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
								Actions
							</Tabs.Tab>
							{loaderData.userMediaDetails.seenBy > 0 ||
							loaderData.userMediaDetails.history.length > 0 ||
							loaderData.userMediaDetails.ownership ? (
								<Tabs.Tab
									value="history"
									leftSection={<IconRotateClockwise size={16} />}
								>
									History
								</Tabs.Tab>
							) : null}
							{loaderData.mediaAdditionalDetails.showSpecifics ? (
								<Tabs.Tab
									value="seasons"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Seasons
								</Tabs.Tab>
							) : null}
							{loaderData.mediaAdditionalDetails.podcastSpecifics ? (
								<Tabs.Tab
									value="episodes"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Episodes
								</Tabs.Tab>
							) : null}
							{!loaderData.coreDetails.reviewsDisabled &&
							loaderData.userMediaDetails &&
							loaderData.userMediaDetails.reviews.length > 0 ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : null}
							{(loaderData.mediaAdditionalDetails.suggestions.length || 0) >
							0 ? (
								<Tabs.Tab
									value="suggestions"
									leftSection={<IconBulb size={16} />}
								>
									Suggestions
								</Tabs.Tab>
							) : null}
							{!loaderData.coreDetails.videosDisabled &&
							(loaderData.mediaAdditionalDetails.assets.videos.length || 0) >
								0 ? (
								<Tabs.Tab value="videos" leftSection={<IconVideo size={16} />}>
									Videos
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
										{loaderData.mediaMainDetails.genres
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
											))}
									</SimpleGrid>
									{loaderData.mediaMainDetails.description ? (
										<div
											// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
											dangerouslySetInnerHTML={{
												__html: loaderData.mediaMainDetails.description,
											}}
										/>
									) : null}
									<Stack>
										{loaderData.mediaAdditionalDetails.creators.map((c) => (
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
															<Box key={creator.id}>
																{creator.id ? (
																	<Anchor
																		component={Link}
																		data-creator-id={creator.id}
																		to={$path("/media/people/:id", {
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
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="actions">
							<MediaScrollArea
								itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
							>
								<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
									{loaderData.userMediaDetails.inProgress ? (
										<ProgressModal
											progress={loaderData.userMediaDetails.inProgress.progress}
											metadataId={loaderData.metadataId}
											onClose={progressModalClose}
											opened={progressModalOpened}
											lot={loaderData.mediaMainDetails.lot}
											total={
												loaderData.mediaAdditionalDetails.audioBookSpecifics
													?.runtime ||
												loaderData.mediaAdditionalDetails.bookSpecifics
													?.pages ||
												loaderData.mediaAdditionalDetails.movieSpecifics
													?.runtime ||
												loaderData.mediaAdditionalDetails.mangaSpecifics
													?.chapters ||
												loaderData.mediaAdditionalDetails.animeSpecifics
													?.episodes ||
												loaderData.mediaAdditionalDetails.visualNovelSpecifics
													?.length
											}
										/>
									) : null}
									<Menu shadow="md">
										<Menu.Target>
											<Button variant="outline">Update progress</Button>
										</Menu.Target>
										<Menu.Dropdown>
											{loaderData.mediaMainDetails.lot === MetadataLot.Show ||
											loaderData.mediaMainDetails.lot ===
												MetadataLot.Podcast ? (
												<>
													<Menu.Label>Shows and podcasts</Menu.Label>
													{loaderData.userMediaDetails.nextEpisode ? (
														<>
															<Menu.Item
																component={Link}
																to={
																	loaderData.mediaMainDetails.lot ===
																	MetadataLot.Podcast
																		? $path(
																				"/media/item/:id/update-progress",
																				{ id: loaderData.metadataId },
																				{
																					title:
																						loaderData.mediaMainDetails.title,
																					podcastEpisodeNumber:
																						loaderData.userMediaDetails
																							.nextEpisode.episodeNumber,
																					isShow: false,
																					isPodcast: true,
																				},
																		  )
																		: $path(
																				"/media/item/:id/update-progress",
																				{
																					id: loaderData.metadataId,
																				},
																				{
																					title:
																						loaderData.mediaMainDetails.title,
																					showSeasonNumber:
																						loaderData.userMediaDetails
																							.nextEpisode.seasonNumber,
																					showEpisodeNumber:
																						loaderData.userMediaDetails
																							.nextEpisode.episodeNumber,
																					isShow: true,
																					isPodcast: false,
																				},
																		  )
																}
															>
																Mark{" "}
																{loaderData.mediaMainDetails.lot ===
																MetadataLot.Show
																	? `S${loaderData.userMediaDetails.nextEpisode?.seasonNumber}-E${loaderData.userMediaDetails.nextEpisode?.episodeNumber}`
																	: `EP-${loaderData.userMediaDetails.nextEpisode?.episodeNumber}`}{" "}
																as seen
															</Menu.Item>
															<PutOnHoldBtn />
														</>
													) : null}
													{loaderData.userMediaDetails &&
													loaderData.userMediaDetails.history.length !== 0 ? (
														<DropBtn />
													) : (
														<Menu.Item disabled>
															No history. Update from the seasons/episodes tab.
														</Menu.Item>
													)}
												</>
											) : null}
											{loaderData.userMediaDetails?.inProgress ? (
												<>
													<Menu.Label>In progress</Menu.Label>
													<Form action="?intent=progressUpdate" method="post">
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
														MetadataLot.Show &&
													loaderData.mediaMainDetails.lot !==
														MetadataLot.Podcast ? (
														<StateChangeButtons />
													) : null}
												</>
											) : loaderData.mediaMainDetails.lot !==
													MetadataLot.Show &&
											  loaderData.mediaMainDetails.lot !==
													MetadataLot.Podcast ? (
												<>
													<Menu.Label>Not in progress</Menu.Label>
													<Form action="?intent=progressUpdate" method="post">
														<input hidden name="progress" defaultValue={0} />
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
													</Form>
													<Menu.Item
														component={Link}
														to={$path(
															"/media/item/:id/update-progress",
															{ id: loaderData.metadataId },
															{
																title: loaderData.mediaMainDetails.title,
																isShow: false,
																isPodcast: false,
															},
														)}
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
									{!loaderData.coreDetails.reviewsDisabled ? (
										<Button
											variant="outline"
											w="100%"
											component={Link}
											to={$path(
												"/media/:id/post-review",
												{ id: loaderData.metadataId },
												{
													title: loaderData.mediaMainDetails.title,
													entityType: "metadata",
													isPodcast:
														loaderData.mediaMainDetails.lot ===
														MetadataLot.Podcast,
													isShow:
														loaderData.mediaMainDetails.lot ===
														MetadataLot.Show,
													showSeasonNumber:
														loaderData.userMediaDetails?.nextEpisode
															?.seasonNumber ?? undefined,
													showEpisodeNumber:
														loaderData.mediaMainDetails.lot === MetadataLot.Show
															? loaderData.userMediaDetails?.nextEpisode
																	?.episodeNumber ?? undefined
															: null,
													podcastEpisodeNumber:
														loaderData.mediaMainDetails.lot ===
														MetadataLot.Podcast
															? loaderData.userMediaDetails?.nextEpisode
																	?.episodeNumber ?? undefined
															: null,
												},
											)}
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
											collections={loaderData.collections.map((c) => c.name)}
										/>
									</>
									<Menu shadow="md">
										<Menu.Target>
											<Button variant="outline">More actions</Button>
										</Menu.Target>
										<Menu.Dropdown>
											<Form action="?intent=toggleMediaMonitor" method="post">
												<Menu.Item
													type="submit"
													color={
														loaderData.userMediaDetails.isMonitored
															? "red"
															: undefined
													}
													name="metadataId"
													value={loaderData.metadataId}
													onClick={(e) => {
														if (loaderData.userMediaDetails.isMonitored)
															if (
																!confirm(
																	"Are you sure you want to stop monitoring this media?",
																)
															)
																e.preventDefault();
													}}
												>
													{loaderData.userMediaDetails.isMonitored
														? "Stop"
														: "Start"}{" "}
													monitoring
												</Menu.Item>
											</Form>
											<Form
												action="?intent=deployUpdateMetadataJob"
												method="post"
											>
												<Menu.Item
													type="submit"
													name="metadataId"
													value={loaderData.metadataId}
												>
													Update metadata
												</Menu.Item>
											</Form>
											{loaderData.userMediaDetails.reminder ? (
												<Form
													action="?intent=deleteMediaReminder"
													method="post"
												>
													<Menu.Item
														type="submit"
														color={
															loaderData.userMediaDetails.reminder
																? "red"
																: undefined
														}
														name="metadataId"
														value={loaderData.metadataId}
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
											{loaderData.userMediaDetails.ownership ? (
												<Form
													action="?intent=toggleMediaOwnership"
													method="post"
												>
													<Menu.Item
														type="submit"
														color="red"
														name="metadataId"
														value={loaderData.metadataId}
														onClick={(e) => {
															if (loaderData.userMediaDetails.ownership)
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
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="history">
							<MediaScrollArea
								itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
							>
								<Stack>
									<Box>
										<Text>
											Seen by all users {loaderData.userMediaDetails.seenBy}{" "}
											time
											{loaderData.userMediaDetails.seenBy > 1 ? "s" : ""} and{" "}
											{loaderData.userMediaDetails.history.length} time
											{loaderData.userMediaDetails &&
											loaderData.userMediaDetails.history.length > 1
												? "s"
												: ""}{" "}
											by you.
										</Text>
										{loaderData.userMediaDetails.ownership ? (
											<Text>
												You owned this media
												{loaderData.userMediaDetails.ownership.ownedOn
													? ` on ${loaderData.userMediaDetails.ownership.ownedOn}`
													: null}
												.
											</Text>
										) : null}
									</Box>
									{loaderData.userMediaDetails.history.map((h) => (
										<SeenItem history={h} key={h.id} />
									))}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
						{loaderData.mediaAdditionalDetails.showSpecifics ? (
							<Tabs.Panel value="seasons">
								<MediaScrollArea
									itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
								>
									<Accordion
										chevronPosition="right"
										variant="contained"
										defaultValue={loaderData.query.showSeasonNumber?.toString()}
									>
										{loaderData.mediaAdditionalDetails.showSpecifics.seasons.map(
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
																	loaderData.userMediaDetails.history.some(
																		(h) =>
																			h.progress === 100 &&
																			h.showInformation &&
																			h.showInformation.episode ===
																				e.episodeNumber &&
																			h.showInformation.season ===
																				s.seasonNumber,
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
																		component={Link}
																		to={$path(
																			"/media/item/:id/update-progress",
																			{ id: loaderData.metadataId },
																			{
																				title:
																					loaderData.mediaMainDetails.title,
																				showSeasonNumber: s.seasonNumber,
																				onlySeason: true,
																				isShow:
																					loaderData.mediaMainDetails.lot ===
																					MetadataLot.Show,
																				isPodcast:
																					loaderData.mediaMainDetails.lot ===
																					MetadataLot.Podcast,
																			},
																		)}
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
																<Box mb="xs" ml="md" key={e.id}>
																	<AccordionLabel
																		{...e}
																		key={e.episodeNumber}
																		name={`${e.episodeNumber}. ${e.name}`}
																		publishDate={e.publishDate}
																		displayIndicator={
																			loaderData.userMediaDetails.history.filter(
																				(h) =>
																					h.progress === 100 &&
																					h.showInformation &&
																					h.showInformation.episode ===
																						e.episodeNumber &&
																					h.showInformation.season ===
																						s.seasonNumber,
																			).length || 0
																		}
																	>
																		<Button
																			variant="outline"
																			component={Link}
																			to={$path(
																				"/media/item/:id/update-progress",
																				{ id: loaderData.metadataId },
																				{
																					title:
																						loaderData.mediaMainDetails.title,
																					showSeasonNumber: s.seasonNumber,
																					showEpisodeNumber: e.episodeNumber,
																					isShow:
																						loaderData.mediaMainDetails.lot ===
																						MetadataLot.Show,
																					isPodcast:
																						loaderData.mediaMainDetails.lot ===
																						MetadataLot.Podcast,
																				},
																			)}
																		>
																			Mark as seen
																		</Button>
																	</AccordionLabel>
																</Box>
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
						{loaderData.mediaAdditionalDetails.podcastSpecifics ? (
							<Tabs.Panel value="episodes">
								<MediaScrollArea
									itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
								>
									<Stack ml="md">
										{loaderData.mediaAdditionalDetails.podcastSpecifics.episodes.map(
											(e) => (
												<AccordionLabel
													{...e}
													name={e.title}
													posterImages={[e.thumbnail || ""]}
													key={e.number}
													publishDate={e.publishDate}
													displayIndicator={
														loaderData.userMediaDetails.history.filter(
															(h) => h.podcastInformation?.episode === e.number,
														).length || 0
													}
												>
													<Button
														variant="outline"
														component={Link}
														to={$path(
															"/media/item/:id/update-progress",
															{ id: loaderData.metadataId },
															{
																title: loaderData.mediaMainDetails.title,
																podcastEpisodeNumber: e.number,
																isShow:
																	loaderData.mediaMainDetails.lot ===
																	MetadataLot.Show,
																isPodcast:
																	loaderData.mediaMainDetails.lot ===
																	MetadataLot.Podcast,
															},
														)}
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
						{!loaderData.coreDetails.reviewsDisabled ? (
							<Tabs.Panel value="reviews">
								<MediaScrollArea
									itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
								>
									<Stack>
										{loaderData.userMediaDetails.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												metadataId={loaderData.metadataId}
												reviewScale={loaderData.userPreferences.reviewScale}
												user={loaderData.userDetails}
												title={loaderData.mediaMainDetails.title}
											/>
										))}
									</Stack>
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
						<Tabs.Panel value="suggestions">
							<MediaScrollArea
								itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
							>
								<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
									{loaderData.mediaAdditionalDetails.suggestions.map((sug) => (
										<PartialMetadataDisplay key={sug.identifier} media={sug} />
									))}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						{!loaderData.coreDetails.videosDisabled ? (
							<Tabs.Panel value="videos">
								<MediaScrollArea
									itemDetailsHeight={loaderData.coreDetails.itemDetailsHeight}
								>
									<Stack>
										{loaderData.mediaAdditionalDetails.assets.videos.map(
											(v) => (
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
											),
										)}
									</Stack>
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
					</Tabs>
				</MediaDetailsLayout>
			</Container>
		</>
	);
}

const ProgressModal = (props: {
	opened: boolean;
	onClose: () => void;
	metadataId: number;
	progress: number;
	total?: number | null;
	lot: MetadataLot;
}) => {
	const [value, setValue] = useState(props.progress);

	const [updateIcon, text] = match(props.lot)
		.with(MetadataLot.Book, () => [<IconBook size={24} />, "Pages"])
		.with(MetadataLot.Anime, () => [<IconDeviceTv size={24} />, "Episodes"])
		.with(MetadataLot.Manga, () => [<IconBrandPagekit size={24} />, "Chapters"])
		.with(
			MetadataLot.Movie,
			MetadataLot.VisualNovel,
			MetadataLot.AudioBook,
			() => [<IconClock size={24} />, "Minutes"],
		)
		.otherwise(() => [null, null]);

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
			size="sm"
		>
			<Form action="?intent=progressUpdate" method="post">
				<input hidden name="metadataId" defaultValue={props.metadataId} />
				<input hidden name="progress" defaultValue={value} />
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
							onChange={(v) => setValue(Number(v))}
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
									value={Math.ceil(((props.total || 1) * value) / 100)}
									onChange={(v) => {
										const newVal = (Number(v) / (props.total || 1)) * 100;
										setValue(Math.ceil(newVal));
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

const CreateReminderModal = (props: {
	opened: boolean;
	onClose: () => void;
	title: string;
	metadataId: number;
}) => {
	const [remindOn, setRemindOn] = useState(new Date());

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form method="post" action="?intent=createMediaReminder">
				<input
					hidden
					name="remindOn"
					value={formatDateToNaiveDate(remindOn)}
					readOnly
				/>
				<Stack>
					<Title order={3}>Create a reminder</Title>
					<Text>
						A notification will be sent to all your configured{" "}
						<Anchor to={$path("/settings/notifications")} component={Link}>
							platforms
						</Anchor>
						.
					</Text>
					<TextInput
						name="message"
						label="Message"
						required
						defaultValue={`Complete '${props.title}'`}
					/>
					<DateInput
						label="Remind on"
						popoverProps={{ withinPortal: true }}
						required
						onChange={(v) => {
							if (v) setRemindOn(v);
						}}
						value={remindOn}
					/>
					<Button
						data-autofocus
						variant="outline"
						type="submit"
						onClick={props.onClose}
						name="metadataId"
						value={props.metadataId}
					>
						Submit
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};

const CreateOwnershipModal = (props: {
	opened: boolean;
	metadataId: number;
	onClose: () => void;
}) => {
	const [ownedOn, setOwnedOn] = useState<Date | null>();

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form method="post" action="?intent=toggleMediaOwnership">
				<Stack>
					<Title order={3}>Mark media as owned</Title>
					<DateInput
						label="When did you get this media?"
						clearable
						popoverProps={{ withinPortal: true }}
						onChange={setOwnedOn}
						value={ownedOn}
					/>
					<input hidden name="metadataId" defaultValue={props.metadataId} />
					<input
						hidden
						name="ownedOn"
						value={ownedOn ? formatDateToNaiveDate(ownedOn) : undefined}
					/>
					<SimpleGrid cols={2}>
						<Button
							variant="outline"
							onClick={props.onClose}
							disabled={!!ownedOn}
							data-autofocus
							type="submit"
						>
							I don't remember
						</Button>
						<Button
							disabled={!ownedOn}
							variant="outline"
							type="submit"
							onClick={props.onClose}
						>
							Submit
						</Button>
					</SimpleGrid>
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
			<Form method="post" action="?intent=mergeMetadata">
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
		.join(", ");

	return (
		<Stack data-episode-id={props.id}>
			<Flex align="center" gap="sm">
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
				{props.children}
			</Flex>
			<Group gap={6}>
				<Text>{props.name}</Text>
				{display ? (
					<Text size="xs" c="dimmed">
						({display})
					</Text>
				) : null}
			</Group>
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

type History = UserMediaDetailsQuery["userMediaDetails"]["history"][number];

const SeenItem = (props: {
	history: History;
}) => {
	const [opened, { open, close }] = useDisclosure(false);

	return (
		<>
			<Flex
				key={props.history.id}
				gap={{ base: "xs", md: "lg", xl: "xl" }}
				data-seen-id={props.history.id}
				data-seen-num-times-updated={props.history.numTimesUpdated}
			>
				<Flex direction="column" justify="center">
					<Form action="?intent=deleteSeenItem" method="post">
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
					<ActionIcon
						color="blue"
						onClick={() => {
							if (props.history.state === SeenState.Completed) open();
							else
								notifications.show({
									color: "yellow",
									message: "You can only edit completed items.",
								});
						}}
					>
						<IconEdit size={20} />
					</ActionIcon>
				</Flex>
				<Flex direction="column">
					<Flex gap="xl">
						<Text fw="bold">
							{changeCase(props.history.state)}{" "}
							{props.history.progress !== 100
								? `(${props.history.progress}%)`
								: null}
						</Text>
						{props.history.showInformation ? (
							<Text c="dimmed">
								S{props.history.showInformation.season}-E
								{props.history.showInformation.episode}
							</Text>
						) : null}
						{props.history.podcastInformation ? (
							<Text c="dimmed">
								EP-{props.history.podcastInformation.episode}
							</Text>
						) : null}
					</Flex>
					<Flex ml="sm" direction="column" gap={{ md: 4 }}>
						<Flex gap={{ base: "md", md: "xl" }} wrap="wrap">
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
						</Flex>
						<Flex gap="md">
							<Flex gap="xs">
								<Text size="sm">Updated:</Text>
								<Text size="sm" fw="bold">
									{dayjsLib(props.history.lastUpdatedOn).format("L")}
								</Text>
							</Flex>
						</Flex>
					</Flex>
				</Flex>
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
