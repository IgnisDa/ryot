import {
	Accordion,
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
import { LoaderFunctionArgs, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	type CreateMediaReminderMutationVariables,
	type DeployBulkProgressUpdateMutationVariables,
	EntityLot,
	MediaAdditionalDetailsDocument,
	MediaMainDetailsDocument,
	MetadataLot,
	MetadataSource,
	MetadataVideoSource,
	SeenState,
	UserCollectionsListDocument,
	UserMediaDetailsDocument,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatDateToNaiveDate } from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconBook,
	IconBrandPagekit,
	IconBulb,
	IconClock,
	IconDeviceTv,
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
import { useMutation } from "@tanstack/react-query";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import { DateTime } from "luxon";
import { useState } from "react";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { MediaDetailsLayout } from "~/components/common";
import {
	AddEntityToCollectionModal,
	DisplayCollection,
	MediaScrollArea,
	PartialMetadataDisplay,
	ReviewItemDisplay,
} from "~/components/media-components";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import { useGetMantineColor } from "~/lib/hooks";
import { Verb, getVerb } from "~/lib/utilities";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const [coreDetails, userPreferences] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
	]);
	const id = params.id;
	invariant(id, "No ID provided");
	const metadataId = parseInt(id);
	const [
		{ mediaDetails: mediaMainDetails },
		{ mediaDetails: mediaAdditionalDetails },
		{ userMediaDetails },
		{ userCollectionsList: collections },
	] = await Promise.all([
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
		userPreferences,
		coreDetails,
		metadataId,
		mediaMainDetails,
		mediaAdditionalDetails,
		userMediaDetails,
		collections,
	});
};

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

	// const progressUpdate = useMutation({
	// 	mutationFn: async (
	// 		variables: DeployBulkProgressUpdateMutationVariables,
	// 	) => {
	// 		const { deployBulkProgressUpdate } = await gqlClient.request(
	// 			DeployBulkProgressUpdateDocument,
	// 			variables,
	// 		);
	// 		return deployBulkProgressUpdate;
	// 	},
	// 	onSuccess: () => {
	// 		setTimeout(() => {
	// 			userMediaDetails.refetch();
	// 		}, 1000);
	// 	},
	// });
	// const deleteMediaReminder = useMutation({
	// 	mutationFn: async (variables: DeleteMediaReminderMutationVariables) => {
	// 		const { deleteMediaReminder } = await gqlClient.request(
	// 			DeleteMediaReminderDocument,
	// 			variables,
	// 		);
	// 		return deleteMediaReminder;
	// 	},
	// 	onSuccess: () => {
	// 		userMediaDetails.refetch();
	// 	},
	// });
	// const toggleMediaMonitor = useMutation({
	// 	mutationFn: async (variables: ToggleMediaMonitorMutationVariables) => {
	// 		const { toggleMediaMonitor } = await gqlClient.request(
	// 			ToggleMediaMonitorDocument,
	// 			variables,
	// 		);
	// 		return toggleMediaMonitor;
	// 	},
	// 	onSuccess: () => {
	// 		userMediaDetails.refetch();
	// 	},
	// });
	// const toggleMediaOwnership = useMutation({
	// 	mutationFn: async (variables: ToggleMediaOwnershipMutationVariables) => {
	// 		const { toggleMediaOwnership } = await gqlClient.request(
	// 			ToggleMediaOwnershipDocument,
	// 			variables,
	// 		);
	// 		return toggleMediaOwnership;
	// 	},
	// 	onSuccess: () => {
	// 		mediaOwnershipModalClose();
	// 		userMediaDetails.refetch();
	// 	},
	// });
	// const deleteSeenItem = useMutation({
	// 	mutationFn: async (variables: DeleteSeenItemMutationVariables) => {
	// 		const { deleteSeenItem } = await gqlClient.request(
	// 			DeleteSeenItemDocument,
	// 			variables,
	// 		);
	// 		return deleteSeenItem;
	// 	},
	// 	onSuccess: () => {
	// 		userMediaDetails.refetch();
	// 		notifications.show({
	// 			title: "Deleted",
	// 			message: "Record deleted from your history successfully",
	// 		});
	// 	},
	// });
	// const deployUpdateMetadataJob = useMutation({
	// 	mutationFn: async (variables: DeployUpdateMetadataJobMutationVariables) => {
	// 		const { deployUpdateMetadataJob } = await gqlClient.request(
	// 			DeployUpdateMetadataJobDocument,
	// 			variables,
	// 		);
	// 		return deployUpdateMetadataJob;
	// 	},
	// 	onSuccess: () => {
	// 		notifications.show({
	// 			title: "Deployed",
	// 			message: "This record's metadata will be updated in the background.",
	// 		});
	// 	},
	// });
	// const mergeMetadata = useMutation({
	// 	mutationFn: async (variables: MergeMetadataMutationVariables) => {
	// 		const { mergeMetadata } = await gqlClient.request(
	// 			MergeMetadataDocument,
	// 			variables,
	// 		);
	// 		return mergeMetadata;
	// 	},
	// 	onSuccess: () => {
	// 		router.push(APP_ROUTES.dashboard);
	// 	},
	// });

	const PutOnHoldBtn = () => {
		return (
			<Menu.Item
				onClick={() => {
					progressUpdate.mutate({
						input: [
							{
								metadataId: loaderData.metadataId,
								changeState: SeenState.OnAHold,
							},
						],
					});
				}}
			>
				Put on hold
			</Menu.Item>
		);
	};
	const DropBtn = () => {
		return (
			<Menu.Item
				color="red"
				onClick={() => {
					const yes = confirm(
						"You will not be able to resume this session after this operation. Continue?",
					);
					if (yes)
						progressUpdate.mutate({
							input: [
								{
									metadataId: loaderData.metadataId,
									changeState: SeenState.Dropped,
								},
							],
						});
				}}
			>
				Mark as dropped
			</Menu.Item>
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
				markMediaAsOwned={(v) =>
					toggleMediaOwnership.mutate({
						metadataId: loaderData.metadataId,
						ownedOn: v,
					})
				}
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
						) : undefined}
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
					) : undefined}
					<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
						{[
							loaderData.mediaMainDetails.publishYear,
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
								`${humanizer.humanize(
									loaderData.mediaAdditionalDetails.movieSpecifics.runtime *
										1000 *
										60,
								)}`,
							loaderData.mediaAdditionalDetails.showSpecifics?.seasons &&
								`${loaderData.mediaAdditionalDetails.showSpecifics.seasons.length} seasons`,
							loaderData.mediaAdditionalDetails.audioBookSpecifics?.runtime &&
								`${humanizer.humanize(
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
										src={`/images/provider-logos/${match(
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
							) : undefined}
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
										{loaderData.userPreferences.general.reviewScale ===
										UserReviewScale.OutOfFive
											? undefined
											: "%"}
									</Text>
								</Paper>
							) : undefined}
						</Group>
					) : undefined}
					{loaderData.userMediaDetails?.reminder ? (
						<Alert
							icon={<IconAlertCircle size={16} />}
							variant="outline"
							color="violet"
						>
							Reminder for {loaderData.userMediaDetails.reminder.remindOn}
							<Text c="green">
								{loaderData.userMediaDetails.reminder.message}
							</Text>
						</Alert>
					) : undefined}
					{loaderData.userMediaDetails?.inProgress ? (
						<Alert icon={<IconAlertCircle size={16} />} variant="outline">
							You are currently{" "}
							{getVerb(Verb.Read, loaderData.mediaMainDetails.lot)}
							ing this ({loaderData.userMediaDetails.inProgress.progress}%)
						</Alert>
					) : undefined}
					<Tabs variant="outline" defaultValue="overview">
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
							{loaderData.userMediaDetails.seenBy > 0 ||
							loaderData.userMediaDetails.history.length > 0 ||
							loaderData.userMediaDetails.ownership ? (
								<Tabs.Tab
									value="history"
									leftSection={<IconRotateClockwise size={16} />}
								>
									History
								</Tabs.Tab>
							) : undefined}
							{loaderData.mediaAdditionalDetails.showSpecifics ? (
								<Tabs.Tab
									value="seasons"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Seasons
								</Tabs.Tab>
							) : undefined}
							{loaderData.mediaAdditionalDetails.podcastSpecifics ? (
								<Tabs.Tab
									value="episodes"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Episodes
								</Tabs.Tab>
							) : undefined}
							{!loaderData.coreDetails.reviewsDisabled &&
							loaderData.userMediaDetails &&
							loaderData.userMediaDetails.reviews.length > 0 ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : undefined}
							{(loaderData.mediaAdditionalDetails.suggestions.length || 0) >
							0 ? (
								<Tabs.Tab
									value="suggestions"
									leftSection={<IconBulb size={16} />}
								>
									Suggestions
								</Tabs.Tab>
							) : undefined}
							{!loaderData.coreDetails.videosDisabled &&
							(loaderData.mediaAdditionalDetails.assets.videos.length || 0) >
								0 ? (
								<Tabs.Tab value="videos" leftSection={<IconVideo size={16} />}>
									Videos
								</Tabs.Tab>
							) : undefined}
						</Tabs.List>
						<Tabs.Panel value="overview">
							<MediaScrollArea coreDetails={loaderData.coreDetails}>
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
									) : undefined}
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
																		/>
																	</Anchor>
																) : (
																	<MetadataCreator
																		name={creator.name}
																		image={creator.image}
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
							<MediaScrollArea coreDetails={loaderData.coreDetails}>
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
									) : undefined}
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
																onClick={async () => {
																	if (
																		loaderData.mediaMainDetails.lot ===
																		MetadataLot.Podcast
																	)
																		router.push(
																			withQuery(
																				APP_ROUTES.media.individualMediaItem
																					.updateProgress,
																				{
																					id: loaderData.metadataId,
																					selectedPodcastEpisodeNumber:
																						loaderData.userMediaDetails
																							.nextEpisode?.episodeNumber,
																				},
																			),
																		);
																	else
																		router.push(
																			withQuery(
																				APP_ROUTES.media.individualMediaItem
																					.updateProgress,
																				{
																					id: loaderData.metadataId,
																					selectedShowSeasonNumber:
																						loaderData.userMediaDetails
																							.nextEpisode?.seasonNumber,
																					selectedShowEpisodeNumber:
																						loaderData.userMediaDetails
																							.nextEpisode?.episodeNumber,
																				},
																			),
																		);
																}}
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
													) : undefined}
													{loaderData.userMediaDetails &&
													loaderData.userMediaDetails.history.length !== 0 ? (
														<DropBtn />
													) : (
														<Menu.Item disabled>
															No history. Update from the seasons/episodes tab.
														</Menu.Item>
													)}
												</>
											) : undefined}
											{loaderData.userMediaDetails?.inProgress ? (
												<>
													<Menu.Label>In progress</Menu.Label>
													<Menu.Item
														onClick={async () => {
															await progressUpdate.mutateAsync({
																input: [
																	{
																		progress: 100,
																		metadataId: loaderData.metadataId,
																		date: DateTime.now().toISODate(),
																	},
																],
															});
														}}
													>
														I finished{" "}
														{getVerb(
															Verb.Read,
															loaderData.mediaMainDetails.lot,
														)}
														ing it
													</Menu.Item>
													<Menu.Item onClick={progressModalOpen}>
														Set progress
													</Menu.Item>
													{loaderData.mediaMainDetails.lot !==
														MetadataLot.Show &&
													loaderData.mediaMainDetails.lot !==
														MetadataLot.Podcast ? (
														<StateChangeButtons />
													) : undefined}
												</>
											) : loaderData.mediaMainDetails.lot !==
													MetadataLot.Show &&
											  loaderData.mediaMainDetails.lot !==
													MetadataLot.Podcast ? (
												<>
													<Menu.Label>Not in progress</Menu.Label>
													<Menu.Item
														onClick={async () => {
															await progressUpdate.mutateAsync({
																input: [
																	{
																		metadataId: loaderData.metadataId,
																		progress: 0,
																	},
																],
															});
														}}
													>
														I'm{" "}
														{getVerb(
															Verb.Read,
															loaderData.mediaMainDetails.lot,
														)}
														ing it
													</Menu.Item>
													<Menu.Item
														component={Link}
														to={$path("/media/item/:id/update-progress", {
															id: loaderData.metadataId,
														})}
													>
														Add to{" "}
														{getVerb(
															Verb.Read,
															loaderData.mediaMainDetails.lot,
														)}{" "}
														history
													</Menu.Item>
												</>
											) : undefined}
										</Menu.Dropdown>
									</Menu>
									{loaderData.coreDetails.reviewsDisabled ? (
										<Button
											variant="outline"
											w="100%"
											component={Link}
											to={$path(
												"/media/item/:id/post-review",
												{ id: loaderData.metadataId },
												{
													entityType: "media",
													showSeasonNumber:
														loaderData.userMediaDetails?.nextEpisode
															?.seasonNumber ?? undefined,
													showEpisodeNumber:
														loaderData.mediaMainDetails.lot === MetadataLot.Show
															? loaderData.userMediaDetails?.nextEpisode
																	?.episodeNumber ?? undefined
															: undefined,
													podcastEpisodeNumber:
														loaderData.mediaMainDetails.lot ===
														MetadataLot.Podcast
															? loaderData.userMediaDetails?.nextEpisode
																	?.episodeNumber ?? undefined
															: undefined,
												},
											)}
										>
											Post a review
										</Button>
									) : undefined}
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
											<Menu.Item
												onClick={() => {
													toggleMediaMonitor.mutate({
														toMonitorMetadataId: loaderData.metadataId,
													});
												}}
												color={
													loaderData.userMediaDetails.isMonitored
														? "red"
														: undefined
												}
											>
												{loaderData.userMediaDetails.isMonitored
													? "Stop"
													: "Start"}{" "}
												monitoring
											</Menu.Item>
											<Menu.Item
												onClick={() => {
													deployUpdateMetadataJob.mutate({
														metadataId: loaderData.metadataId,
													});
												}}
											>
												Update metadata
											</Menu.Item>
											{loaderData.mediaMainDetails.source === "CUSTOM" ? (
												<Menu.Item
													onClick={() => {
														const mergeInto = prompt(
															"Enter ID of the metadata you want to merge this with",
														);
														if (mergeInto) {
															const yes = confirm(
																"Are you sure you want to continue? This will delete the current media item",
															);
															if (yes) {
																mergeMetadata.mutate({
																	mergeFrom: loaderData.metadataId,
																	mergeInto: parseInt(mergeInto),
																});
															}
														}
													}}
												>
													Merge media
												</Menu.Item>
											) : undefined}
											{loaderData.userMediaDetails.reminder ? (
												<Menu.Item
													onClick={() => {
														const yes = confirm(
															"Are you sure you want to remove the reminder?",
														);
														if (yes)
															deleteMediaReminder.mutate({
																metadataId: loaderData.metadataId,
															});
													}}
													color="red"
												>
													Remove reminder
												</Menu.Item>
											) : (
												<Menu.Item onClick={createMediaReminderModalOpen}>
													Create reminder
												</Menu.Item>
											)}
											{loaderData.userMediaDetails.ownership ? (
												<Menu.Item
													onClick={() => {
														const yes = confirm(
															"Are you sure you want to remove ownership?",
														);
														if (yes)
															toggleMediaOwnership.mutate({
																metadataId: loaderData.metadataId,
															});
													}}
													color="red"
												>
													Remove ownership
												</Menu.Item>
											) : (
												<Menu.Item onClick={mediaOwnershipModalOpen}>
													Mark as owned
												</Menu.Item>
											)}
										</Menu.Dropdown>
									</Menu>
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="history">
							<MediaScrollArea coreDetails={loaderData.coreDetails}>
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
													: undefined}
												.
											</Text>
										) : undefined}
									</Box>
									{loaderData.userMediaDetails.history.map((h) => (
										<Flex
											key={h.id}
											direction="column"
											ml="md"
											data-seen-id={h.id}
											data-seen-num-times-updated={h.numTimesUpdated}
										>
											<Flex gap="xl">
												<Text fw="bold">
													{changeCase(h.state)}{" "}
													{h.progress !== 100 ? `(${h.progress}%)` : undefined}
												</Text>
												{h.showInformation ? (
													<Text c="dimmed">
														S{h.showInformation.season}-E
														{h.showInformation.episode}
													</Text>
												) : undefined}
												{h.podcastInformation ? (
													<Text c="dimmed">
														EP-{h.podcastInformation.episode}
													</Text>
												) : undefined}
											</Flex>
											<Flex ml="sm" direction="column" gap={4}>
												<Flex gap="xl">
													<Flex gap="xs">
														<Text size="sm">Started:</Text>
														<Text size="sm" fw="bold">
															{h.startedOn
																? DateTime.fromISO(h.startedOn).toLocaleString()
																: "N/A"}
														</Text>
													</Flex>
													<Flex gap="xs">
														<Text size="sm">Ended:</Text>
														<Text size="sm" fw="bold">
															{h.finishedOn
																? DateTime.fromISO(
																		h.finishedOn,
																  ).toLocaleString()
																: "N/A"}
														</Text>
													</Flex>
												</Flex>
												<Flex gap="md">
													<Flex gap="xs">
														<Text size="sm">Updated:</Text>
														<Text size="sm" fw="bold">
															{DateTime.fromISO(
																h.lastUpdatedOn,
															).toLocaleString()}
														</Text>
													</Flex>
													<Button
														variant="outline"
														color="red"
														leftSection={
															<IconX size={16} style={{ marginTop: 2 }} />
														}
														size="compact-xs"
														onClick={() => {
															const yes = confirm(
																"Are you sure you want to delete this seen item?",
															);
															if (yes) deleteSeenItem.mutate({ seenId: h.id });
														}}
													>
														Delete
													</Button>
												</Flex>
											</Flex>
										</Flex>
									))}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
						{loaderData.mediaAdditionalDetails.showSpecifics ? (
							<Tabs.Panel value="seasons">
								<MediaScrollArea coreDetails={loaderData.coreDetails}>
									<Accordion chevronPosition="right" variant="contained">
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
																				selectedShowSeasonNumber:
																					s.seasonNumber,
																				onlySeason: true,
																			},
																		)}
																	>
																		Mark as seen
																	</Button>
																) : undefined}
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
																					selectedShowSeasonNumber:
																						s.seasonNumber,
																					selectedShowEpisodeNumber:
																						e.episodeNumber,
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
						) : undefined}
						{loaderData.mediaAdditionalDetails.podcastSpecifics ? (
							<Tabs.Panel value="episodes">
								<MediaScrollArea coreDetails={loaderData.coreDetails}>
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
															{ selectedPodcastEpisodeNumber: e.number },
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
						) : undefined}
						{!loaderData.coreDetails.reviewsDisabled ? (
							<Tabs.Panel value="reviews">
								<MediaScrollArea coreDetails={loaderData.coreDetails}>
									<Stack>
										{loaderData.userMediaDetails.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												metadataId={loaderData.metadataId}
											/>
										))}
									</Stack>
								</MediaScrollArea>
							</Tabs.Panel>
						) : undefined}
						<Tabs.Panel value="suggestions">
							<MediaScrollArea coreDetails={loaderData.coreDetails}>
								<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
									{loaderData.mediaAdditionalDetails.suggestions.map((sug) => (
										<PartialMetadataDisplay key={sug.identifier} media={sug} />
									))}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						{!loaderData.coreDetails.videosDisabled ? (
							<Tabs.Panel value="videos">
								<MediaScrollArea coreDetails={loaderData.coreDetails}>
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
						) : undefined}
					</Tabs>
				</MediaDetailsLayout>
			</Container>
		</>
	);
}

const service = new HumanizeDurationLanguage();
const humanizer = new HumanizeDuration(service);

const ProgressModal = (props: {
	opened: boolean;
	onClose: () => void;
	metadataId: number;
	progress: number;
	total?: number | null;
	lot: MetadataLot;
}) => {
	const [value, setValue] = useState(props.progress);
	const progressUpdate = useMutation({
		mutationFn: async (
			variables: DeployBulkProgressUpdateMutationVariables,
		) => {
			// const { deployBulkProgressUpdate } = await gqlClient.request(
			// 	DeployBulkProgressUpdateDocument,
			// 	variables,
			// );
			// return deployBulkProgressUpdate;
		},
		onSuccess: () => {
			props.onClose();
			setTimeout(() => {
				props.refetch();
			}, 1000);
		},
	});

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
				) : undefined}
				<Button
					variant="outline"
					onClick={async () => {
						await progressUpdate.mutateAsync({
							input: [
								{
									progress: value,
									metadataId: props.metadataId,
									date: DateTime.now().toISODate(),
								},
							],
						});
					}}
				>
					Update
				</Button>
				<Button variant="outline" color="red" onClick={props.onClose}>
					Cancel
				</Button>
			</Stack>
		</Modal>
	);
};

const MetadataCreator = (props: { name: string; image?: string | null }) => {
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
			<Text size="xs" c="dimmed" ta="center" lineClamp={1} mt={4}>
				{props.name}
			</Text>
		</>
	);
};

const CreateReminderModal = (props: {
	opened: boolean;
	onClose: () => void;
	title: string;
	metadataId: number;
}) => {
	const [message, setMessage] = useState(`Complete '${props.title}'`);
	const [remindOn, setRemindOn] = useState(new Date());

	const createMediaReminder = useMutation({
		mutationFn: async (variables: CreateMediaReminderMutationVariables) => {
			// const { createMediaReminder } = await gqlClient.request(
			// 	CreateMediaReminderDocument,
			// 	variables,
			// );
			// return createMediaReminder;
		},
		onSuccess: (data) => {
			if (!data)
				notifications.show({
					color: "red",
					message: "Reminder was not created",
				});
			else {
				props.refetchUserMediaDetails();
				props.onClose();
			}
		},
		onError: () => {
			notifications.show({
				color: "red",
				message: "Invalid inputs entered",
			});
		},
	});

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
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
					onChange={(e) => setMessage(e.currentTarget.value)}
					label="Message"
					value={message}
				/>
				<DateInput
					label="Remind on"
					popoverProps={{ withinPortal: true }}
					onChange={(v) => {
						if (v) setRemindOn(v);
					}}
					value={remindOn}
				/>
				<Button
					data-autofocus
					variant="outline"
					onClick={() => {
						createMediaReminder.mutate({
							input: {
								metadataId: props.metadataId,
								message,
								remindOn: formatDateToNaiveDate(remindOn),
							},
						});
					}}
				>
					Submit
				</Button>
			</Stack>
		</Modal>
	);
};

const CreateOwnershipModal = (props: {
	opened: boolean;
	onClose: () => void;
	markMediaAsOwned: (date?: string) => void;
}) => {
	const [ownedOn, setOwnedOn] = useState<Date | null>();

	const onClick = () => {
		props.markMediaAsOwned(
			ownedOn ? formatDateToNaiveDate(ownedOn) : undefined,
		);
	};

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Stack>
				<Title order={3}>Mark media as owned</Title>
				<DateInput
					label="When did you get this media?"
					clearable
					popoverProps={{ withinPortal: true }}
					onChange={setOwnedOn}
					value={ownedOn}
				/>
				<SimpleGrid cols={2}>
					<Button
						variant="outline"
						onClick={onClick}
						disabled={!!ownedOn}
						data-autofocus
					>
						Don't remember
					</Button>
					<Button disabled={!ownedOn} variant="outline" onClick={onClick}>
						Submit
					</Button>
				</SimpleGrid>
			</Stack>
		</Modal>
	);
};

const AccordionLabel = (props: {
	name: string;
	id?: number | null;
	numEpisodes?: number | null;
	posterImages: string[];
	overview?: string | null;
	children: JSX.Element;
	displayIndicator: number;
	runtime?: number | null;
	publishDate?: string | null;
}) => {
	const display = [
		props.runtime ? humanizer.humanize(props.runtime * 1000 * 60) : undefined,
		props.publishDate
			? DateTime.fromISO(props.publishDate).toLocaleString(DateTime.DATE_MED)
			: undefined,
		props.numEpisodes ? `${props.numEpisodes} episodes` : undefined,
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
				) : undefined}
			</Group>
			{props.overview ? (
				<Text
					size="sm"
					c="dimmed"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: generated on the backend securely
					dangerouslySetInnerHTML={{ __html: props.overview }}
				/>
			) : undefined}
		</Stack>
	);
};
