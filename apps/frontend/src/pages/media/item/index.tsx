import {
	AddEntityToCollectionModal,
	DisplayCollection,
	MediaScrollArea,
	PartialMetadataDisplay,
	ReviewItemDisplay,
} from "@/components/MediaComponents";
import MediaDetailsLayout from "@/components/MediaDetailsLayout";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import {
	useCoreDetails,
	useGetMantineColor,
	useUserPreferences,
} from "@/lib/hooks";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Verb, getVerb } from "@/lib/utilities";
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
	Loader,
	MantineThemeProvider,
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
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CreateMediaReminderDocument,
	type CreateMediaReminderMutationVariables,
	DeleteMediaReminderDocument,
	type DeleteMediaReminderMutationVariables,
	DeleteSeenItemDocument,
	type DeleteSeenItemMutationVariables,
	DeployBulkProgressUpdateDocument,
	type DeployBulkProgressUpdateMutationVariables,
	DeployUpdateMetadataJobDocument,
	type DeployUpdateMetadataJobMutationVariables,
	EntityLot,
	MediaAdditionalDetailsDocument,
	MediaMainDetailsDocument,
	MergeMetadataDocument,
	type MergeMetadataMutationVariables,
	MetadataLot,
	MetadataSource,
	MetadataVideoSource,
	SeenState,
	ToggleMediaMonitorDocument,
	type ToggleMediaMonitorMutationVariables,
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
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import { DateTime } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

const service = new HumanizeDurationLanguage();
const humanizer = new HumanizeDuration(service);

const ProgressModal = (props: {
	opened: boolean;
	onClose: () => void;
	metadataId: number;
	progress: number;
	total?: number | null;
	lot: MetadataLot;
	refetch: () => void;
}) => {
	const [value, setValue] = useState(props.progress);
	const progressUpdate = useMutation({
		mutationFn: async (
			variables: DeployBulkProgressUpdateMutationVariables,
		) => {
			const { deployBulkProgressUpdate } = await gqlClient.request(
				DeployBulkProgressUpdateDocument,
				variables,
			);
			return deployBulkProgressUpdate;
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
	refetchUserMediaDetails: () => void;
}) => {
	const [message, setMessage] = useState(`Complete '${props.title}'`);
	const [remindOn, setRemindOn] = useState("");

	const createMediaReminder = useMutation({
		mutationFn: async (variables: CreateMediaReminderMutationVariables) => {
			const { createMediaReminder } = await gqlClient.request(
				CreateMediaReminderDocument,
				variables,
			);
			return createMediaReminder;
		},
		onSuccess: () => {
			props.refetchUserMediaDetails();
			props.onClose();
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
					<Anchor href={APP_ROUTES.settings.notifications} component={Link}>
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
						if (v) setRemindOn(formatDateToNaiveDate(v));
					}}
					defaultValue={new Date()}
				/>
				<Button
					data-autofocus
					variant="outline"
					onClick={() => {
						createMediaReminder.mutate({
							input: { metadataId: props.metadataId, message, remindOn },
						});
					}}
				>
					Submit
				</Button>
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
				{props.runtime ? (
					<Text size="xs" c="dimmed">
						({humanizer.humanize(props.runtime * 1000 * 60)}
						{props.publishDate
							? `, ${DateTime.fromISO(props.publishDate).toLocaleString(
									DateTime.DATE_MED,
							  )}`
							: undefined}
						{props.numEpisodes ? `, ${props.numEpisodes} episodes` : undefined})
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

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const metadataId = parseInt(router.query.id?.toString() || "0");
	const coreDetails = useCoreDetails();
	const preferences = useUserPreferences();
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
	const [activeTab, setActiveTab] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedActiveItemDetailsTab,
		getInitialValueInEffect: true,
		defaultValue: "overview",
	});

	const mediaDetails = useQuery({
		queryKey: ["mediaDetails", metadataId],
		queryFn: async () => {
			const { mediaDetails } = await gqlClient.request(
				MediaMainDetailsDocument,
				{
					metadataId,
				},
			);
			return mediaDetails;
		},
		staleTime: Infinity,
		enabled: !!metadataId,
	});

	useEffect(() => {
		if (
			mediaDetails.data &&
			(activeTab === "seasons" || activeTab === "episodes") &&
			![MetadataLot.Show, MetadataLot.Podcast].includes(mediaDetails.data.lot)
		)
			setActiveTab("overview");
	}, [mediaDetails.data]);

	const mediaSpecifics = useQuery({
		queryKey: ["mediaSpecifics", metadataId],
		queryFn: async () => {
			const { mediaDetails } = await gqlClient.request(
				MediaAdditionalDetailsDocument,
				{
					metadataId,
				},
			);
			return mediaDetails;
		},
		staleTime: Infinity,
		enabled: !!metadataId,
	});
	const userMediaDetails = useQuery({
		queryKey: ["userMediaDetails", metadataId],
		queryFn: async () => {
			const { userMediaDetails } = await gqlClient.request(
				UserMediaDetailsDocument,
				{ metadataId },
			);
			return userMediaDetails;
		},
		enabled: !!metadataId,
	});
	const progressUpdate = useMutation({
		mutationFn: async (
			variables: DeployBulkProgressUpdateMutationVariables,
		) => {
			const { deployBulkProgressUpdate } = await gqlClient.request(
				DeployBulkProgressUpdateDocument,
				variables,
			);
			return deployBulkProgressUpdate;
		},
		onSuccess: () => {
			setTimeout(() => {
				userMediaDetails.refetch();
			}, 1000);
		},
	});
	const deleteMediaReminder = useMutation({
		mutationFn: async (variables: DeleteMediaReminderMutationVariables) => {
			const { deleteMediaReminder } = await gqlClient.request(
				DeleteMediaReminderDocument,
				variables,
			);
			return deleteMediaReminder;
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

	const source = mediaDetails?.data?.source || MetadataSource.Custom;

	const PutOnHoldBtn = () => {
		return (
			<Menu.Item
				onClick={() => {
					progressUpdate.mutate({
						input: [
							{
								metadataId: metadataId,
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
									metadataId: metadataId,
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
	const StateChangeBtns = () => {
		return (
			<>
				<PutOnHoldBtn />
				<DropBtn />
			</>
		);
	};

	return coreDetails.data && mediaDetails.data && preferences.data ? (
		<>
			<Head>
				<title>{mediaDetails.data.title} | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					images={mediaSpecifics.data?.assets.images || []}
					externalLink={{
						source,
						lot: mediaDetails.data.lot,
						href: mediaDetails.data.sourceUrl,
					}}
				>
					<Box>
						{mediaDetails.data.group ? (
							<Link
								href={withQuery(APP_ROUTES.media.groups.details, {
									id: mediaDetails.data.group.id,
								})}
								style={{ color: "unset" }}
							>
								<Text c="dimmed" fs="italic">
									{mediaDetails.data.group.name} #{mediaDetails.data.group.part}
								</Text>
							</Link>
						) : undefined}
						<Group>
							<Title id="media-title">{mediaDetails.data.title}</Title>
							{userMediaDetails.data && mediaSpecifics.data ? undefined : (
								<Loader size="xs" />
							)}
						</Group>
					</Box>
					{userMediaDetails.data &&
					userMediaDetails.data.collections.length > 0 ? (
						<Group id="entity-collections">
							{userMediaDetails.data.collections.map((col) => (
								<DisplayCollection
									col={col}
									entityId={metadataId.toString()}
									entityLot={EntityLot.Media}
									refetch={userMediaDetails.refetch}
									key={col.id}
								/>
							))}
						</Group>
					) : undefined}
					<MantineThemeProvider
						theme={{
							components: {
								Text: Text.extend({
									defaultProps: { c: "dimmed", fz: { base: "sm", lg: "md" } },
								}),
							},
						}}
					>
						<Flex id="media-details" wrap="wrap" gap={6} align="center">
							{mediaDetails.data.publishYear ? (
								<Text>{mediaDetails.data.publishYear}</Text>
							) : undefined}
							{mediaDetails.data.productionStatus ? (
								<Text> • {mediaDetails.data.productionStatus}</Text>
							) : undefined}
							{mediaSpecifics.data?.bookSpecifics?.pages ? (
								<Text> • {mediaSpecifics.data.bookSpecifics.pages} pages</Text>
							) : undefined}
							{mediaSpecifics.data?.podcastSpecifics?.totalEpisodes ? (
								<Text>
									{" "}
									• {mediaSpecifics.data.podcastSpecifics.totalEpisodes}{" "}
									episodes
								</Text>
							) : undefined}
							{mediaSpecifics.data?.animeSpecifics?.episodes ? (
								<Text>
									{" "}
									• {mediaSpecifics.data.animeSpecifics.episodes} episodes
								</Text>
							) : undefined}
							{mediaSpecifics.data?.mangaSpecifics?.chapters ? (
								<Text>
									{" "}
									• {mediaSpecifics.data.mangaSpecifics.chapters} chapters
								</Text>
							) : undefined}
							{mediaSpecifics.data?.mangaSpecifics?.volumes ? (
								<Text>
									{" "}
									• {mediaSpecifics.data.mangaSpecifics.volumes} volumes
								</Text>
							) : undefined}
							{mediaSpecifics.data?.movieSpecifics?.runtime ? (
								<Text>
									{" "}
									•{" "}
									{humanizer.humanize(
										mediaSpecifics.data.movieSpecifics.runtime * 1000 * 60,
									)}
								</Text>
							) : undefined}
							{mediaSpecifics.data?.showSpecifics ? (
								<Text>
									{" "}
									• {mediaSpecifics.data.showSpecifics.seasons.length} seasons
								</Text>
							) : undefined}
							{mediaSpecifics.data?.audioBookSpecifics?.runtime ? (
								<Text>
									{" "}
									•{" "}
									{humanizer.humanize(
										mediaSpecifics.data.audioBookSpecifics.runtime * 1000 * 60,
									)}
								</Text>
							) : undefined}
						</Flex>
					</MantineThemeProvider>
					{mediaDetails.data.providerRating ||
					userMediaDetails.data?.averageRating ? (
						<Group>
							{mediaDetails.data.providerRating ? (
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
											mediaDetails.data.source,
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
										{Number(mediaDetails.data.providerRating).toFixed(1)}
										{match(mediaDetails.data.source)
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
							{userMediaDetails.data?.averageRating ? (
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
										{Number(userMediaDetails.data.averageRating).toFixed(1)}
										{preferences.data.general.reviewScale ===
										UserReviewScale.OutOfFive
											? undefined
											: "%"}
									</Text>
								</Paper>
							) : undefined}
						</Group>
					) : undefined}
					{userMediaDetails.data?.reminder ? (
						<Alert
							icon={<IconAlertCircle size={16} />}
							variant="outline"
							color="violet"
						>
							Reminder for {userMediaDetails.data.reminder.remindOn}
							<Text c="green">{userMediaDetails.data.reminder.message}</Text>
						</Alert>
					) : undefined}
					{userMediaDetails.data?.inProgress ? (
						<Alert icon={<IconAlertCircle size={16} />} variant="outline">
							You are currently {getVerb(Verb.Read, mediaDetails.data.lot)}
							ing this ({userMediaDetails.data.inProgress.progress}%)
						</Alert>
					) : undefined}
					<Tabs
						value={activeTab}
						variant="outline"
						onChange={(v) => {
							if (v) setActiveTab(v);
						}}
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
							{userMediaDetails.data &&
							userMediaDetails.data.history.length > 0 ? (
								<Tabs.Tab
									value="history"
									leftSection={<IconRotateClockwise size={16} />}
								>
									History
								</Tabs.Tab>
							) : undefined}
							{mediaSpecifics.data?.showSpecifics ? (
								<Tabs.Tab
									value="seasons"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Seasons
								</Tabs.Tab>
							) : undefined}
							{mediaSpecifics.data?.podcastSpecifics ? (
								<Tabs.Tab
									value="episodes"
									leftSection={<IconPlayerPlay size={16} />}
								>
									Episodes
								</Tabs.Tab>
							) : undefined}
							{!coreDetails.data.reviewsDisabled &&
							userMediaDetails.data &&
							userMediaDetails.data.reviews.length > 0 ? (
								<Tabs.Tab
									value="reviews"
									leftSection={<IconMessageCircle2 size={16} />}
								>
									Reviews
								</Tabs.Tab>
							) : undefined}
							{(mediaSpecifics.data?.suggestions.length || 0) > 0 ? (
								<Tabs.Tab
									value="suggestions"
									leftSection={<IconBulb size={16} />}
								>
									Suggestions
								</Tabs.Tab>
							) : undefined}
							{!coreDetails.data.videosDisabled &&
							(mediaSpecifics.data?.assets.videos.length || 0) > 0 ? (
								<Tabs.Tab value="videos" leftSection={<IconVideo size={16} />}>
									Videos
								</Tabs.Tab>
							) : undefined}
						</Tabs.List>
						<Tabs.Panel value="overview">
							<MediaScrollArea>
								<Stack gap="sm">
									<SimpleGrid
										cols={{ base: 3, xl: 4 }}
										spacing={{ base: "md", lg: "xs" }}
									>
										{mediaDetails.data.genres
											.slice(0, 12)
											.toSorted((a, b) => a.name.length - b.name.length)
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
														href={withQuery(APP_ROUTES.media.genres.details, {
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
									{mediaDetails.data.description ? (
										<div
											// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
											dangerouslySetInnerHTML={{
												__html: mediaDetails.data.description,
											}}
										/>
									) : undefined}
									<Stack>
										{mediaSpecifics.data?.creators.map((c) => (
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
																		href={withQuery(
																			APP_ROUTES.media.people.details,
																			{ id: creator.id },
																		)}
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
							<MediaScrollArea>
								<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
									{userMediaDetails.data?.inProgress ? (
										<ProgressModal
											progress={userMediaDetails.data.inProgress.progress}
											refetch={userMediaDetails.refetch}
											metadataId={metadataId}
											onClose={progressModalClose}
											opened={progressModalOpened}
											lot={mediaDetails.data.lot}
											total={
												mediaSpecifics.data?.audioBookSpecifics?.runtime ||
												mediaSpecifics.data?.bookSpecifics?.pages ||
												mediaSpecifics.data?.movieSpecifics?.runtime ||
												mediaSpecifics.data?.mangaSpecifics?.chapters ||
												mediaSpecifics.data?.animeSpecifics?.episodes ||
												mediaSpecifics.data?.visualNovelSpecifics?.length
											}
										/>
									) : undefined}
									<Menu shadow="md" withinPortal>
										<Menu.Target>
											<Button variant="outline">Update progress</Button>
										</Menu.Target>
										<Menu.Dropdown>
											{mediaDetails.data.lot === MetadataLot.Show ||
											mediaDetails.data.lot === MetadataLot.Podcast ? (
												<>
													<Menu.Label>Shows and podcasts</Menu.Label>
													{userMediaDetails.data?.nextEpisode ? (
														<>
															<Menu.Item
																onClick={async () => {
																	if (
																		mediaDetails.data.lot ===
																		MetadataLot.Podcast
																	)
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
															</Menu.Item>
															<PutOnHoldBtn />
														</>
													) : undefined}
													{userMediaDetails.data &&
													userMediaDetails.data.history.length !== 0 ? (
														<DropBtn />
													) : (
														<Menu.Item disabled>
															No history. Update from the seasons/episodes tab.
														</Menu.Item>
													)}
												</>
											) : undefined}
											{userMediaDetails.data?.inProgress ? (
												<>
													<Menu.Label>In progress</Menu.Label>
													<Menu.Item
														onClick={async () => {
															await progressUpdate.mutateAsync({
																input: [
																	{
																		progress: 100,
																		metadataId: metadataId,
																		date: DateTime.now().toISODate(),
																	},
																],
															});
														}}
													>
														I finished{" "}
														{getVerb(Verb.Read, mediaDetails.data.lot)}
														ing it
													</Menu.Item>
													<Menu.Item onClick={progressModalOpen}>
														Set progress
													</Menu.Item>
													{mediaDetails.data.lot !== MetadataLot.Show &&
													mediaDetails.data.lot !== MetadataLot.Podcast ? (
														<StateChangeBtns />
													) : undefined}
												</>
											) : mediaDetails.data.lot !== MetadataLot.Show &&
											  mediaDetails.data.lot !== MetadataLot.Podcast ? (
												<>
													<Menu.Label>Not in progress</Menu.Label>
													<Menu.Item
														onClick={async () => {
															await progressUpdate.mutateAsync({
																input: [
																	{
																		metadataId: metadataId,
																		progress: 0,
																	},
																],
															});
														}}
													>
														I'm {getVerb(Verb.Read, mediaDetails.data.lot)}
														ing it
													</Menu.Item>

													<Menu.Item
														onClick={() => {
															router.push(
																withQuery(
																	APP_ROUTES.media.individualMediaItem
																		.updateProgress,
																	{
																		id: metadataId,
																	},
																),
															);
														}}
													>
														Add to {getVerb(Verb.Read, mediaDetails.data.lot)}{" "}
														history
													</Menu.Item>
												</>
											) : undefined}
										</Menu.Dropdown>
									</Menu>
									{!coreDetails.data.reviewsDisabled ? (
										<Button
											variant="outline"
											w="100%"
											component={Link}
											href={withQuery(APP_ROUTES.media.postReview, {
												metadataId,
												showSeasonNumber:
													userMediaDetails.data?.nextEpisode?.seasonNumber ??
													undefined,
												showEpisodeNumber:
													mediaDetails.data.lot === MetadataLot.Show
														? userMediaDetails.data?.nextEpisode
																?.episodeNumber ?? undefined
														: undefined,
												podcastEpisodeNumber:
													mediaDetails.data.lot === MetadataLot.Podcast
														? userMediaDetails.data?.nextEpisode
																?.episodeNumber ?? undefined
														: undefined,
											})}
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
											entityId={metadataId.toString()}
											refetchUserMedia={userMediaDetails.refetch}
											entityLot={EntityLot.Media}
										/>
									</>
									<Button
										variant="outline"
										onClick={() => {
											toggleMediaMonitor.mutate({
												toMonitorMetadataId: metadataId,
											});
										}}
									>
										{userMediaDetails.data?.isMonitored ? "Stop" : "Start"}{" "}
										monitoring
									</Button>
									{userMediaDetails.data?.reminder ? (
										<Button
											variant="outline"
											onClick={() => {
												deleteMediaReminder.mutate({ metadataId });
											}}
										>
											Remove reminder
										</Button>
									) : (
										<>
											<CreateReminderModal
												onClose={createMediaReminderModalClose}
												opened={createMediaReminderModalOpened}
												metadataId={metadataId}
												title={mediaDetails.data.title}
												refetchUserMediaDetails={userMediaDetails.refetch}
											/>
											<Button
												variant="outline"
												onClick={createMediaReminderModalOpen}
											>
												Create reminder
											</Button>
										</>
									)}
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
									) : undefined}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="history">
							<MediaScrollArea>
								<Stack>
									<Text>
										Seen by all users {userMediaDetails.data?.seenBy} time
										{userMediaDetails.data && userMediaDetails.data.seenBy > 1
											? "s"
											: ""}{" "}
										and {userMediaDetails.data?.history.length} time
										{userMediaDetails.data &&
										userMediaDetails.data.history.length > 1
											? "s"
											: ""}{" "}
										by you
									</Text>
									{userMediaDetails.data?.history.map((h) => (
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
															{DateTime.fromJSDate(
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
						{mediaSpecifics.data?.showSpecifics ? (
							<Tabs.Panel value="seasons">
								<MediaScrollArea>
									<Accordion chevronPosition="right" variant="contained">
										{mediaSpecifics.data.showSpecifics.seasons.map((s) => (
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
																userMediaDetails.data?.history.some(
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
														<>
															{s.episodes.length > 0 ? (
																<Button
																	variant="outline"
																	component={Link}
																	href={withQuery(
																		APP_ROUTES.media.individualMediaItem
																			.updateProgress,
																		{
																			id: metadataId,
																			selectedShowSeasonNumber: s.seasonNumber,
																			onlySeason: 1,
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
																		userMediaDetails.data?.history.filter(
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
																		href={withQuery(
																			APP_ROUTES.media.individualMediaItem
																				.updateProgress,
																			{
																				id: metadataId,
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
										))}
									</Accordion>
								</MediaScrollArea>
							</Tabs.Panel>
						) : undefined}
						{mediaSpecifics.data?.podcastSpecifics ? (
							<Tabs.Panel value="episodes">
								<MediaScrollArea>
									<Stack ml="md">
										{mediaSpecifics.data.podcastSpecifics.episodes.map((e) => (
											<AccordionLabel
												{...e}
												name={e.title}
												posterImages={[e.thumbnail || ""]}
												key={e.number}
												publishDate={e.publishDate}
												displayIndicator={
													userMediaDetails.data?.history.filter(
														(h) => h.podcastInformation?.episode === e.number,
													).length || 0
												}
											>
												<Button
													variant="outline"
													component={Link}
													href={withQuery(
														APP_ROUTES.media.individualMediaItem.updateProgress,
														{
															id: metadataId,
															selectedPodcastEpisodeNumber: e.number,
														},
													)}
												>
													Mark as seen
												</Button>
											</AccordionLabel>
										))}
									</Stack>
								</MediaScrollArea>
							</Tabs.Panel>
						) : undefined}
						{!coreDetails.data.reviewsDisabled ? (
							<Tabs.Panel value="reviews">
								<MediaScrollArea>
									<Stack>
										{userMediaDetails.data?.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												metadataId={metadataId}
												refetch={userMediaDetails.refetch}
											/>
										))}
									</Stack>
								</MediaScrollArea>
							</Tabs.Panel>
						) : undefined}
						<Tabs.Panel value="suggestions">
							<MediaScrollArea>
								<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
									{mediaSpecifics.data?.suggestions.map((sug) => (
										<PartialMetadataDisplay key={sug.identifier} media={sug} />
									))}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						{!coreDetails.data.videosDisabled ? (
							<Tabs.Panel value="videos">
								<MediaScrollArea>
									<Stack>
										{mediaSpecifics.data?.assets.videos.map((v) => (
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
						) : undefined}
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
