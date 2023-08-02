import type { NextPageWithLayout } from "../../_app";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { MediaScrollArea, ReviewItemDisplay } from "@/lib/components/MediaItem";
import { APP_ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Verb, getStringAsciiValue, getVerb } from "@/lib/utilities";
import {
	Accordion,
	ActionIcon,
	Alert,
	Anchor,
	Avatar,
	Badge,
	Box,
	Button,
	Container,
	Flex,
	Group,
	Indicator,
	type MantineGradient,
	Modal,
	NumberInput,
	ScrollArea,
	Select,
	SimpleGrid,
	Slider,
	Stack,
	Tabs,
	Text,
	Title,
	useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	AddMediaToCollectionDocument,
	type AddMediaToCollectionMutationVariables,
	CollectionsDocument,
	DeleteSeenItemDocument,
	type DeleteSeenItemMutationVariables,
	DeployUpdateMetadataJobDocument,
	type DeployUpdateMetadataJobMutationVariables,
	MediaDetailsDocument,
	MergeMetadataDocument,
	type MergeMetadataMutationVariables,
	MetadataLot,
	MetadataSource,
	ProgressUpdateDocument,
	type ProgressUpdateMutationVariables,
	RemoveMediaFromCollectionDocument,
	type RemoveMediaFromCollectionMutationVariables,
	SeenState,
	ToggleMediaMonitorDocument,
	type ToggleMediaMonitorMutationVariables,
	UserMediaDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/utilities";
import {
	IconAlertCircle,
	IconBook,
	IconBrandPagekit,
	IconClock,
	IconDeviceTv,
	IconInfoCircle,
	IconMessageCircle2,
	IconPercentage,
	IconPlayerPlay,
	IconRotateClockwise,
	IconUser,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import { DateTime } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import { match } from "ts-pattern";
import { withQuery } from "ufo";

const service = new HumanizeDurationLanguage();
const humaizer = new HumanizeDuration(service);

function ProgressModal(props: {
	opened: boolean;
	onClose: () => void;
	metadataId: number;
	progress: number;
	total?: number | null;
	lot: MetadataLot;
	refetch: () => void;
}) {
	const [value, setValue] = useState(props.progress);
	const progressUpdate = useMutation({
		mutationFn: async (variables: ProgressUpdateMutationVariables) => {
			const { progressUpdate } = await gqlClient.request(
				ProgressUpdateDocument,
				variables,
			);
			return progressUpdate;
		},
		onSuccess: () => {
			props.refetch();
			props.onClose();
		},
	});

	const [updateIcon, text] = match(props.lot)
		.with(MetadataLot.Book, () => [<IconBook size="1.5rem" />, "Pages"])
		.with(MetadataLot.Anime, () => [<IconDeviceTv size="1.5rem" />, "Episodes"])
		.with(MetadataLot.Manga, () => [
			<IconBrandPagekit size="1.5rem" />,
			"Chapters",
		])
		.with(MetadataLot.Movie, MetadataLot.AudioBook, () => [
			<IconClock size="1.5rem" />,
			"Minutes",
		])
		.otherwise(() => [null, null]);

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
			size={"sm"}
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
						w={"20%"}
						hideControls
						rightSection={<IconPercentage size="1rem" />}
					/>
				</Group>
				{props.total ? (
					<>
						<Text align="center" fw={"bold"}>
							OR
						</Text>
						<Flex align={"center"} gap="xs">
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
								icon={updateIcon}
							/>
							<Text>{text}</Text>
						</Flex>
					</>
				) : null}
				<Button
					variant="outline"
					onClick={async () => {
						await progressUpdate.mutateAsync({
							input: {
								progress: value,
								metadataId: props.metadataId,
								date: DateTime.now().toISODate(),
							},
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
}

function SelectCollectionModal(props: {
	opened: boolean;
	onClose: () => void;
	metadataId: number;
	refetchCollections: () => void;
	collections: string[];
}) {
	const [selectedCollection, setSelectedCollection] = useState<string | null>(
		null,
	);

	const addMediaToCollection = useMutation({
		mutationFn: async (variables: AddMediaToCollectionMutationVariables) => {
			const { addMediaToCollection } = await gqlClient.request(
				AddMediaToCollectionDocument,
				variables,
			);
			return addMediaToCollection;
		},
		onSuccess: () => {
			props.refetchCollections();
			props.onClose();
		},
	});

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			{props.collections ? (
				<Stack>
					<Title order={3}>Select collection</Title>
					{props.collections.length > 0 ? (
						<Select
							withinPortal
							data={props.collections}
							onChange={setSelectedCollection}
							searchable
							nothingFound="Nothing found"
						/>
					) : null}
					<Button
						data-autofocus
						variant="outline"
						onClick={() => {
							addMediaToCollection.mutate({
								input: {
									collectionName: selectedCollection || "",
									mediaId: props.metadataId,
								},
							});
						}}
					>
						Set
					</Button>
					<Button variant="outline" color="red" onClick={props.onClose}>
						Cancel
					</Button>
				</Stack>
			) : null}
		</Modal>
	);
}

const AccordionLabel = ({
	name,
	posterImages,
	overview,
	children,
	displayIndicator,
	runtime,
}: {
	name: string;
	posterImages: string[];
	overview?: string | null;
	children: JSX.Element;
	displayIndicator: number;
	runtime?: number | null;
}) => {
	return (
		<Stack>
			<Flex align={"center"} gap="sm">
				<Indicator
					disabled={displayIndicator === 0}
					label={displayIndicator === 1 ? "Seen" : `Seen X${displayIndicator}`}
					offset={7}
					position="bottom-end"
					size={16}
					color="red"
				>
					<Avatar src={posterImages[0]} radius="xl" size="lg" />
				</Indicator>
				{children}
			</Flex>
			<Group spacing={6}>
				<Text>{name}</Text>
				{runtime ? (
					<Text size={"xs"} color="dimmed">
						({humaizer.humanize(runtime * 1000 * 60)})
					</Text>
				) : null}
			</Group>
			{overview ? (
				<Text
					size="sm"
					color="dimmed"
					dangerouslySetInnerHTML={{ __html: overview }}
				/>
			) : null}
		</Stack>
	);
};

const Page: NextPageWithLayout = () => {
	const [changeState, setChangeState] = useState<SeenState>();

	const [
		progressModalOpened,
		{ open: progressModalOpen, close: progressModalClose },
	] = useDisclosure(false);
	const [
		changeStateModalOpened,
		{ open: changeStateModalOpen, close: changeStateModalClose },
	] = useDisclosure(false);
	const [
		collectionModalOpened,
		{ open: collectionModalOpen, close: collectionModalClose },
	] = useDisclosure(false);
	const router = useRouter();
	const metadataId = parseInt(router.query.id?.toString() || "0");
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	const userMediaDetails = useQuery({
		queryKey: ["userMediaDetails", metadataId],
		queryFn: async () => {
			const { userMediaDetails } = await gqlClient.request(
				UserMediaDetailsDocument,
				{ metadataId },
			);
			return userMediaDetails;
		},
		staleTime: Infinity,
		enabled: !!metadataId,
	});
	const mediaDetails = useQuery({
		queryKey: ["mediaDetails", metadataId],
		queryFn: async () => {
			const { mediaDetails } = await gqlClient.request(MediaDetailsDocument, {
				metadataId,
			});
			return mediaDetails;
		},
		staleTime: Infinity,
		enabled: !!metadataId,
	});
	const collections = useQuery({
		queryKey: ["collections"],
		queryFn: async () => {
			const { collections } = await gqlClient.request(CollectionsDocument, {});
			return collections;
		},
	});
	const progressUpdate = useMutation({
		mutationFn: async (variables: ProgressUpdateMutationVariables) => {
			const { progressUpdate } = await gqlClient.request(
				ProgressUpdateDocument,
				variables,
			);
			return progressUpdate;
		},
		onSuccess: () => {
			userMediaDetails.refetch();
		},
	});
	const toggleMediaMonitor = useMutation({
		mutationFn: async (variables: ToggleMediaMonitorMutationVariables) => {
			const { toggleMediaMonitor } = await gqlClient.request(
				ToggleMediaMonitorDocument,
				variables,
			);
			return toggleMediaMonitor;
		},
		onSuccess: () => {
			userMediaDetails.refetch();
		},
	});
	const deleteSeenItem = useMutation({
		mutationFn: async (variables: DeleteSeenItemMutationVariables) => {
			const { deleteSeenItem } = await gqlClient.request(
				DeleteSeenItemDocument,
				variables,
			);
			return deleteSeenItem;
		},
		onSuccess: () => {
			userMediaDetails.refetch();
			notifications.show({
				title: "Deleted",
				message: "Record deleted from your history successfully",
			});
		},
	});
	const deployUpdateMetadataJob = useMutation({
		mutationFn: async (variables: DeployUpdateMetadataJobMutationVariables) => {
			const { deployUpdateMetadataJob } = await gqlClient.request(
				DeployUpdateMetadataJobDocument,
				variables,
			);
			return deployUpdateMetadataJob;
		},
		onSuccess: () => {
			notifications.show({
				title: "Deployed",
				message: "This record's metadata will be updated in the background.",
			});
		},
	});
	const mergeMetadata = useMutation({
		mutationFn: async (variables: MergeMetadataMutationVariables) => {
			const { mergeMetadata } = await gqlClient.request(
				MergeMetadataDocument,
				variables,
			);
			return mergeMetadata;
		},
		onSuccess: () => {
			router.push(APP_ROUTES.dashboard);
		},
	});
	const removeMediaFromCollection = useMutation({
		mutationFn: async (
			variables: RemoveMediaFromCollectionMutationVariables,
		) => {
			const { removeMediaFromCollection } = await gqlClient.request(
				RemoveMediaFromCollectionDocument,
				variables,
			);
			return removeMediaFromCollection;
		},
		onSuccess: () => {
			userMediaDetails.refetch();
		},
	});

	const badgeGradient: MantineGradient = match(mediaDetails.data?.lot)
		.with(MetadataLot.AudioBook, () => ({ from: "indigo", to: "cyan" }))
		.with(MetadataLot.Book, () => ({ from: "teal", to: "lime" }))
		.with(MetadataLot.Movie, () => ({ from: "teal", to: "blue" }))
		.with(MetadataLot.Show, () => ({ from: "orange", to: "red" }))
		.with(MetadataLot.VideoGame, () => ({
			from: "purple",
			to: "blue",
		}))
		.with(MetadataLot.Anime, () => ({
			from: "red",
			to: "blue",
		}))
		.with(MetadataLot.Manga, () => ({
			from: "red",
			to: "green",
		}))
		.with(MetadataLot.Podcast, undefined, () => ({
			from: "yellow",
			to: "purple",
		}))
		.exhaustive();

	const source = mediaDetails?.data?.source || MetadataSource.Custom;

	return mediaDetails.data && userMediaDetails.data ? (
		<>
			<Head>
				<title>{mediaDetails.data.title} | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					backdropImages={mediaDetails.data.backdropImages}
					posterImages={mediaDetails.data.posterImages}
					externalLink={{
						source,
						href: mediaDetails.data.sourceUrl,
					}}
				>
					<Group>
						<Title id="media-title">{mediaDetails.data.title}</Title>
						<Badge variant="gradient" gradient={badgeGradient}>
							{changeCase(mediaDetails.data.lot)}
						</Badge>
					</Group>
					{userMediaDetails.data.collections.length > 0 ? (
						<Group id="media-collections">
							{userMediaDetails.data.collections.map((col) => (
								<Badge
									key={col.id}
									color={
										colors[
											// taken from https://stackoverflow.com/questions/44975435/using-mod-operator-in-javascript-to-wrap-around#comment76926119_44975435
											(getStringAsciiValue(col.name) + colors.length) %
												colors.length
										]
									}
								>
									<Flex gap={2}>
										<Text truncate>{col.name}</Text>
										<ActionIcon
											size="1rem"
											onClick={() => {
												const yes = confirm(
													"Are you sure you want to remove this media from this collection?",
												);
												if (yes)
													removeMediaFromCollection.mutate({
														collectionName: col.name,
														metadataId,
													});
											}}
										>
											<IconX />
										</ActionIcon>
									</Flex>
								</Badge>
							))}
						</Group>
					) : null}
					<Flex id="media-details" wrap={"wrap"} gap={4}>
						{mediaDetails.data.genres.length > 0 ? (
							<Text color="dimmed">
								{mediaDetails.data.genres.slice(0, 3).join(", ")}
							</Text>
						) : null}
						{mediaDetails.data.bookSpecifics?.pages ? (
							<Text color="dimmed">
								{" "}
								• {mediaDetails.data.bookSpecifics.pages} pages
							</Text>
						) : null}
						{mediaDetails.data.podcastSpecifics?.totalEpisodes ? (
							<Text color="dimmed">
								{" "}
								• {mediaDetails.data.podcastSpecifics.totalEpisodes} episodes
							</Text>
						) : null}
						{mediaDetails.data.animeSpecifics?.episodes ? (
							<Text color="dimmed">
								{" "}
								• {mediaDetails.data.animeSpecifics.episodes} episodes
							</Text>
						) : null}
						{mediaDetails.data.mangaSpecifics?.chapters ? (
							<Text color="dimmed">
								{" "}
								• {mediaDetails.data.mangaSpecifics.chapters} chapters
							</Text>
						) : null}
						{mediaDetails.data.mangaSpecifics?.volumes ? (
							<Text color="dimmed">
								{" "}
								• {mediaDetails.data.mangaSpecifics.volumes} volumes
							</Text>
						) : null}
						{mediaDetails.data.movieSpecifics?.runtime ? (
							<Text color="dimmed">
								{" "}
								•{" "}
								{humaizer.humanize(
									mediaDetails.data.movieSpecifics.runtime * 1000 * 60,
								)}
							</Text>
						) : null}
						{mediaDetails.data.showSpecifics ? (
							<Text color="dimmed">
								{" "}
								• {mediaDetails.data.showSpecifics.seasons.length} seasons
							</Text>
						) : null}
						{mediaDetails.data.audioBookSpecifics?.runtime ? (
							<Text color="dimmed">
								{" "}
								•{" "}
								{humaizer.humanize(
									mediaDetails.data.audioBookSpecifics.runtime * 1000 * 60,
								)}
							</Text>
						) : null}
						{mediaDetails.data.publishYear ? (
							<Text color="dimmed"> • {mediaDetails.data.publishYear}</Text>
						) : null}
					</Flex>
					{userMediaDetails.data.inProgress ? (
						<Alert icon={<IconAlertCircle size="1rem" />} variant="outline">
							You are currently {getVerb(Verb.Read, mediaDetails.data.lot)}
							ing this ({userMediaDetails.data.inProgress.progress}%)
						</Alert>
					) : null}
					<Tabs
						defaultValue={
							userMediaDetails.data.history.length > 0 ? "actions" : "overview"
						}
						variant="outline"
					>
						<Tabs.List mb={"xs"}>
							<Tabs.Tab value="overview" icon={<IconInfoCircle size="1rem" />}>
								Overview
							</Tabs.Tab>
							<Tabs.Tab value="actions" icon={<IconUser size="1rem" />}>
								Actions
							</Tabs.Tab>
							<Tabs.Tab
								value="history"
								icon={<IconRotateClockwise size="1rem" />}
							>
								History
							</Tabs.Tab>
							{mediaDetails.data.showSpecifics ? (
								<Tabs.Tab value="seasons" icon={<IconPlayerPlay size="1rem" />}>
									Seasons
								</Tabs.Tab>
							) : null}
							{mediaDetails.data.podcastSpecifics ? (
								<Tabs.Tab
									value="episodes"
									icon={<IconPlayerPlay size="1rem" />}
								>
									Episodes
								</Tabs.Tab>
							) : null}
							<Tabs.Tab
								value="reviews"
								icon={<IconMessageCircle2 size="1rem" />}
							>
								Reviews
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="overview">
							<MediaScrollArea>
								<>
									{mediaDetails.data.description ? (
										<Text
											dangerouslySetInnerHTML={{
												__html: mediaDetails.data.description,
											}}
										/>
									) : (
										<Text fs="italic">No overview available</Text>
									)}
									<Stack mt="xl">
										{mediaDetails.data.creators.map((c) => (
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
														xl: 650,
													}}
												>
													<Flex gap="md">
														{c.items.map((creator) => (
															<Link
																key={creator.id}
																passHref
																legacyBehavior
																href={withQuery(
																	APP_ROUTES.media.people.details,
																	{ id: creator.id },
																)}
															>
																<Anchor data-creator-id={creator.id}>
																	<Avatar
																		imageProps={{ loading: "lazy" }}
																		src={creator.image}
																		h={100}
																		w={85}
																		mx="auto"
																		alt={`${creator.name} profile picture`}
																		styles={{
																			image: { objectPosition: "top" },
																		}}
																	/>
																	<Text
																		size="xs"
																		color="dimmed"
																		align="center"
																		lineClamp={1}
																		mt={4}
																	>
																		{creator.name}
																	</Text>
																</Anchor>
															</Link>
														))}
													</Flex>
												</ScrollArea>
											</Box>
										))}
									</Stack>
								</>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="actions">
							<MediaScrollArea>
								<SimpleGrid
									cols={1}
									spacing="lg"
									breakpoints={[{ minWidth: "md", cols: 2 }]}
								>
									{userMediaDetails.data.inProgress ? (
										<>
											<Button variant="outline" onClick={progressModalOpen}>
												Set progress
											</Button>
											<ProgressModal
												progress={userMediaDetails.data.inProgress.progress}
												refetch={userMediaDetails.refetch}
												metadataId={metadataId}
												onClose={progressModalClose}
												opened={progressModalOpened}
												lot={mediaDetails.data.lot}
												total={
													mediaDetails.data.audioBookSpecifics?.runtime ||
													mediaDetails.data.bookSpecifics?.pages ||
													mediaDetails.data.movieSpecifics?.runtime ||
													mediaDetails.data.mangaSpecifics?.chapters ||
													mediaDetails.data.animeSpecifics?.episodes
												}
											/>
											<Button
												variant="outline"
												onClick={async () => {
													await progressUpdate.mutateAsync({
														input: {
															progress: 100,
															metadataId: metadataId,
															date: DateTime.now().toISODate(),
														},
													});
												}}
											>
												I finished {getVerb(Verb.Read, mediaDetails.data.lot)}
												ing it
											</Button>
										</>
									) : mediaDetails.data.lot === MetadataLot.Show ||
									  mediaDetails.data.lot === MetadataLot.Podcast ? (
										userMediaDetails.data.nextEpisode !== null ? (
											<Button
												variant="outline"
												onClick={async () => {
													if (mediaDetails.data.lot === MetadataLot.Podcast)
														router.push(
															withQuery(
																APP_ROUTES.media.individualMediaItem
																	.updateProgress,
																{
																	id: metadataId,
																	selectedPodcastEpisodeNumber:
																		userMediaDetails.data.nextEpisode
																			?.episodeNumber,
																},
															),
														);
													else
														router.push(
															withQuery(
																APP_ROUTES.media.individualMediaItem
																	.updateProgress,
																{
																	id: metadataId,
																	selectedShowSeasonNumber:
																		userMediaDetails.data.nextEpisode
																			?.seasonNumber,
																	selectedShowEpisodeNumber:
																		userMediaDetails.data.nextEpisode
																			?.episodeNumber,
																},
															),
														);
												}}
											>
												Mark{" "}
												{mediaDetails.data.lot === MetadataLot.Show
													? `S${userMediaDetails.data.nextEpisode?.seasonNumber}-E${userMediaDetails.data.nextEpisode?.episodeNumber}`
													: `EP-${userMediaDetails.data.nextEpisode?.episodeNumber}`}{" "}
												as seen
											</Button>
										) : null
									) : (
										<Button
											variant="outline"
											onClick={async () => {
												await progressUpdate.mutateAsync({
													input: { metadataId: metadataId, progress: 0 },
												});
											}}
										>
											I'm {getVerb(Verb.Read, mediaDetails.data.lot)}
											ing it
										</Button>
									)}
									{userMediaDetails.data.history.length > 0 &&
									userMediaDetails.data.inProgress &&
									![SeenState.OnAHold, SeenState.Dropped].includes(
										userMediaDetails.data.inProgress.state,
									) ? (
										<>
											<Button variant="outline" onClick={changeStateModalOpen}>
												Put on hold/drop
											</Button>
											<Modal
												opened={changeStateModalOpened}
												onClose={changeStateModalClose}
												withCloseButton={false}
												centered
											>
												<Stack>
													<Title order={3}>Change state</Title>
													<Select
														withinPortal
														data={["Drop", "Put on hold"]}
														onChange={(v) => {
															if (v) {
																const state = match(v)
																	.with("Drop", () => SeenState.Dropped)
																	.with("Put on hold", () => SeenState.OnAHold)
																	.otherwise(() => undefined);
																if (state) setChangeState(state);
															}
														}}
													/>
													<Button
														variant="outline"
														onClick={() => {
															if (changeState)
																progressUpdate.mutate({
																	input: {
																		metadataId: metadataId,
																		changeState: changeState,
																	},
																});
															setChangeState(undefined);
															changeStateModalClose();
														}}
													>
														Set
													</Button>
													<Button
														variant="outline"
														color="red"
														onClick={changeStateModalClose}
													>
														Cancel
													</Button>
												</Stack>
											</Modal>
										</>
									) : mediaDetails.data.lot === MetadataLot.Show ||
									  mediaDetails.data.lot === MetadataLot.Podcast ? (
										<Button
											variant="outline"
											onClick={() => {
												if (mediaDetails.data.lot === MetadataLot.Show)
													router.push(
														withQuery(
															APP_ROUTES.media.individualMediaItem
																.updateProgress,
															{
																idx: metadataId,
																completeShow: 1,
															},
														),
													);
												else
													router.push(
														withQuery(
															APP_ROUTES.media.individualMediaItem
																.updateProgress,
															{
																id: metadataId,
																completePodcast: 1,
															},
														),
													);
											}}
										>
											Mark {changeCase(mediaDetails.data.lot).toLowerCase()} as
											seen
										</Button>
									) : null}
									<Button
										variant="outline"
										onClick={() => {
											router.push(
												withQuery(
													APP_ROUTES.media.individualMediaItem.updateProgress,
													{
														id: metadataId,
													},
												),
											);
										}}
									>
										Add to {getVerb(Verb.Read, mediaDetails.data.lot)} history
									</Button>
									<Link
										href={withQuery(
											APP_ROUTES.media.individualMediaItem.postReview,
											{
												metadataId,
												showSeasonNumber:
													userMediaDetails.data.nextEpisode?.seasonNumber ??
													undefined,
												showEpisodeNumber:
													mediaDetails.data.lot === MetadataLot.Show
														? userMediaDetails.data.nextEpisode
																?.episodeNumber ?? undefined
														: undefined,
												podcastEpisodeNumber:
													mediaDetails.data.lot === MetadataLot.Podcast
														? userMediaDetails.data.nextEpisode
																?.episodeNumber ?? undefined
														: undefined,
											},
										)}
										passHref
										legacyBehavior
									>
										<Anchor>
											<Button variant="outline" w="100%">
												Post a review
											</Button>
										</Anchor>
									</Link>
									<>
										<Button variant="outline" onClick={collectionModalOpen}>
											Add to collection
										</Button>
										{collections.data && collections.data.length > 0 ? (
											<SelectCollectionModal
												onClose={collectionModalClose}
												opened={collectionModalOpened}
												metadataId={metadataId}
												collections={collections.data.map((c) => c.name)}
												refetchCollections={collections.refetch}
											/>
										) : null}
									</>
									<Button
										variant="outline"
										onClick={() => {
											toggleMediaMonitor.mutate({
												toMonitorMetadataId: metadataId,
											});
										}}
									>
										{userMediaDetails.data.isMonitored ? "Stop" : "Start"}{" "}
										monitoring
									</Button>
									<Button
										variant="outline"
										onClick={() => {
											deployUpdateMetadataJob.mutate({ metadataId });
										}}
									>
										Update metadata
									</Button>
									{source === "CUSTOM" ? (
										<Button
											variant="outline"
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
															mergeFrom: metadataId,
															mergeInto: parseInt(mergeInto),
														});
													}
												}
											}}
										>
											Merge media
										</Button>
									) : null}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="history">
							<MediaScrollArea>
								<Stack>
									<Text>
										Seen by all users {mediaDetails.data.seenBy} time
										{mediaDetails.data.seenBy > 1 ? "s" : ""} and{" "}
										{userMediaDetails.data.history.length} time
										{userMediaDetails.data.history.length > 1 ? "s" : ""} by you
									</Text>
									{userMediaDetails.data.history.length > 0 ? (
										userMediaDetails.data.history.map((h) => (
											<Flex
												key={h.id}
												direction={"column"}
												ml="md"
												data-seen-id={h.id}
											>
												<Flex gap="xl">
													<Text fw="bold">
														{changeCase(h.state)}{" "}
														{h.progress !== 100 ? `(${h.progress}%)` : null}
													</Text>
													{h.showInformation ? (
														<Text color="dimmed">
															S{h.showInformation.season}-E
															{h.showInformation.episode}
														</Text>
													) : null}
													{h.podcastInformation ? (
														<Text color="dimmed">
															EP-{h.podcastInformation.episode}
														</Text>
													) : null}
												</Flex>
												<Flex ml="sm" direction={"column"} gap={4}>
													<Flex gap="xl">
														<Flex gap={"xs"}>
															<Text size="sm">Started:</Text>
															<Text size="sm" fw="bold">
																{h.startedOn
																	? DateTime.fromISO(
																			h.startedOn,
																	  ).toLocaleString()
																	: "N/A"}
															</Text>
														</Flex>
														<Flex gap={"xs"}>
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
													<Flex gap={"md"}>
														<Flex gap={"xs"}>
															<Text size="sm">Updated:</Text>
															<Text size="sm" fw="bold">
																{DateTime.fromJSDate(
																	h.lastUpdatedOn,
																).toLocaleString()}
															</Text>
														</Flex>
														<Button
															variant="outline"
															color="red"
															leftIcon={<IconX size="1.2rem" />}
															compact
															onClick={() => {
																deleteSeenItem.mutate({ seenId: h.id });
															}}
														>
															Delete
														</Button>
													</Flex>
												</Flex>
											</Flex>
										))
									) : (
										<Text fs="italic">You have no history for this item</Text>
									)}
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
						{mediaDetails.data.showSpecifics ? (
							<Tabs.Panel value="seasons">
								<MediaScrollArea>
									<Accordion chevronPosition="right" variant="contained">
										{mediaDetails.data.showSpecifics.seasons.map((s) => (
											<Accordion.Item
												value={s.seasonNumber.toString()}
												key={s.seasonNumber}
											>
												<Accordion.Control>
													<AccordionLabel
														{...s}
														name={`${s.seasonNumber}. ${s.name}`}
														displayIndicator={
															s.episodes.length > 0 &&
															s.episodes.every((e) =>
																userMediaDetails.data.history.some(
																	(h) =>
																		h.progress === 100 &&
																		h.showInformation &&
																		h.showInformation.episode ===
																			e.episodeNumber &&
																		h.showInformation.season === s.seasonNumber,
																),
															)
																? 1
																: 0
														}
														runtime={s.episodes
															.map((e) => e.runtime || 0)
															.reduce((i, a) => i + a, 0)}
													>
														<Button
															variant="outline"
															onClick={() => {
																router.push(
																	withQuery(
																		APP_ROUTES.media.individualMediaItem
																			.updateProgress,
																		{
																			id: metadataId,
																			selectedShowSeasonNumber: s.seasonNumber,
																			onlySeason: 1,
																		},
																	),
																);
															}}
														>
															Mark as seen
														</Button>
													</AccordionLabel>
												</Accordion.Control>
												<Accordion.Panel>
													{s.episodes.length > 0 ? (
														s.episodes.map((e) => (
															<Box mb={"xs"} ml={"md"} key={e.id}>
																<AccordionLabel
																	{...e}
																	key={e.episodeNumber}
																	name={`${e.episodeNumber}. ${e.name}`}
																	displayIndicator={
																		userMediaDetails.data.history.filter(
																			(h) =>
																				h.progress === 100 &&
																				h.showInformation &&
																				h.showInformation.episode ===
																					e.episodeNumber &&
																				h.showInformation.season ===
																					s.seasonNumber,
																		).length
																	}
																>
																	<Button
																		variant="outline"
																		onClick={() => {
																			router.push(
																				withQuery(
																					APP_ROUTES.media.individualMediaItem
																						.updateProgress,
																					{
																						id: metadataId,
																						selectedShowSeasonNumber:
																							s.seasonNumber,
																						selectedShowEpisodeNumber:
																							e.episodeNumber,
																					},
																				),
																			);
																		}}
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
										))}
									</Accordion>
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
						{mediaDetails.data.podcastSpecifics ? (
							<Tabs.Panel value="episodes">
								<MediaScrollArea>
									<Stack ml="md">
										{mediaDetails.data.podcastSpecifics.episodes.map((e) => (
											<AccordionLabel
												{...e}
												name={e.title}
												posterImages={[e.thumbnail || ""]}
												key={e.number}
												displayIndicator={
													userMediaDetails.data.history.filter(
														(h) => h.podcastInformation?.episode === e.number,
													).length
												}
											>
												<Button
													variant="outline"
													onClick={() => {
														router.push(
															withQuery(
																APP_ROUTES.media.individualMediaItem
																	.updateProgress,
																{
																	id: metadataId,
																	selectedPodcastEpisodeNumber: e.number,
																},
															),
														);
													}}
												>
													Mark as seen
												</Button>
											</AccordionLabel>
										))}
									</Stack>
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
						<Tabs.Panel value="reviews">
							{userMediaDetails.data.reviews.length > 0 ? (
								<MediaScrollArea>
									<Stack>
										{userMediaDetails.data.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												metadataId={metadataId}
											/>
										))}
									</Stack>
								</MediaScrollArea>
							) : (
								<Text fs="italic">No reviews posted</Text>
							)}
						</Tabs.Panel>
					</Tabs>
				</MediaDetailsLayout>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
