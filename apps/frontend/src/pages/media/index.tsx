import type { NextPageWithLayout } from "../_app";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { ROUTES } from "@/lib/constants";
import { useUser } from "@/lib/hooks/graphql";
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
	Collapse,
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
	Spoiler,
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
	MergeMetadataDocument,
	type MergeMetadataMutationVariables,
	MetadataLot,
	MetadataSource,
	ProgressUpdateDocument,
	type ProgressUpdateMutationVariables,
	RemoveMediaFromCollectionDocument,
	type RemoveMediaFromCollectionMutationVariables,
	type ReviewItem,
	SeenState,
	ToggleMediaMonitorDocument,
	type ToggleMediaMonitorMutationVariables,
	UserMediaDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials } from "@ryot/utilities";
import {
	IconAlertCircle,
	IconBook,
	IconBrandPagekit,
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
import { type ReactElement, useMemo, useState } from "react";
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

const MediaScrollArea = ({
	children,
}: {
	children: JSX.Element;
}) => {
	return <ScrollArea.Autosize mah={300}>{children}</ScrollArea.Autosize>;
};

const ReviewItem = ({
	review,
	metadataId,
}: {
	review: ReviewItem;
	metadataId: number;
}) => {
	const [opened, { toggle }] = useDisclosure(false);
	const user = useUser();

	return (
		<Box key={review.id} data-review-id={review.id}>
			<Flex align={"center"} gap={"sm"}>
				<Avatar color="cyan" radius="xl">
					{getInitials(review.postedBy.name)}{" "}
				</Avatar>
				<Box>
					<Text>{review.postedBy.name}</Text>
					<Text>{DateTime.fromJSDate(review.postedOn).toLocaleString()}</Text>
				</Box>
				{user && user.id === review.postedBy.id ? (
					<Link
						href={`${ROUTES.media.individualMedia.postReview}?item=${metadataId}&reviewId=${review.id}`}
						passHref
						legacyBehavior
					>
						<Anchor>
							<ActionIcon>
								<IconEdit size="1rem" />
							</ActionIcon>
						</Anchor>
					</Link>
				) : null}
			</Flex>
			<Box ml={"sm"} mt={"xs"}>
				{typeof review.showSeason === "number" ? (
					<Text color="dimmed">
						S{review.showSeason}-E
						{review.showEpisode}
					</Text>
				) : null}
				{typeof review.podcastEpisode === "number" ? (
					<Text color="dimmed">EP-{review.podcastEpisode}</Text>
				) : null}
				{review.rating > 0 ? (
					<Flex align={"center"} gap={4}>
						<IconStarFilled size={"1rem"} style={{ color: "#EBE600FF" }} />
						<Text color="white" fw="bold">
							{review.rating} %
						</Text>
					</Flex>
				) : null}
				{review.text ? (
					!review.spoiler ? (
						<Text dangerouslySetInnerHTML={{ __html: review.text }} />
					) : (
						<>
							{!opened ? (
								<Button onClick={toggle} variant={"subtle"} compact>
									Show spoiler
								</Button>
							) : null}
							<Collapse in={opened}>
								<Text dangerouslySetInnerHTML={{ __html: review.text }} />
							</Collapse>
						</>
					)
				) : null}
			</Box>
		</Box>
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
	const metadataId = parseInt(router.query.item?.toString() || "0");
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
			userMediaDetails.refetch();
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
			router.push(ROUTES.dashboard);
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
			collections.refetch();
		},
	});

	const creators = useMemo(() => {
		const creators: Record<string, { name: string }[]> = {};
		for (const c of userMediaDetails.data?.mediaDetails.creators || []) {
			if (c.role in creators) {
				creators[c.role].push({ name: c.name });
			} else {
				creators[c.role] = [{ name: c.name }];
			}
		}
		const platforms =
			userMediaDetails.data?.mediaDetails.videoGameSpecifics?.platforms;
		if (platforms) {
			creators["Platforms"] = platforms.map((p) => ({
				name: p,
			}));
		}
		return creators;
	}, [userMediaDetails.data]);

	const badgeGradient: MantineGradient = match(
		userMediaDetails.data?.mediaDetails.lot,
	)
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

	const source =
		userMediaDetails?.data?.mediaDetails.source || MetadataSource.Custom;

	return userMediaDetails.data ? (
		<>
			<Head>
				<title>{userMediaDetails.data.mediaDetails.title} | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					backdropImages={userMediaDetails.data.mediaDetails.backdropImages}
					posterImages={userMediaDetails.data.mediaDetails.posterImages}
					externalLink={{
						source,
						href: userMediaDetails.data.mediaDetails.sourceUrl,
					}}
				>
					<Group>
						<Title id="media-title">
							{userMediaDetails.data.mediaDetails.title}
						</Title>
						<Badge variant="gradient" gradient={badgeGradient}>
							{changeCase(userMediaDetails.data.mediaDetails.lot)}
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
						{userMediaDetails.data.mediaDetails.genres.length > 0 ? (
							<Text color="dimmed">
								{userMediaDetails.data.mediaDetails.genres
									.slice(0, 3)
									.join(", ")}
							</Text>
						) : null}
						{userMediaDetails.data.mediaDetails.bookSpecifics?.pages ? (
							<Text color="dimmed">
								{" "}
								• {userMediaDetails.data.mediaDetails.bookSpecifics.pages} pages
							</Text>
						) : null}
						{userMediaDetails.data.mediaDetails.podcastSpecifics
							?.totalEpisodes ? (
							<Text color="dimmed">
								{" "}
								•{" "}
								{
									userMediaDetails.data.mediaDetails.podcastSpecifics
										.totalEpisodes
								}{" "}
								episodes
							</Text>
						) : null}
						{userMediaDetails.data.mediaDetails.animeSpecifics?.episodes ? (
							<Text color="dimmed">
								{" "}
								• {userMediaDetails.data.mediaDetails.animeSpecifics.episodes}{" "}
								episodes
							</Text>
						) : null}
						{userMediaDetails.data.mediaDetails.mangaSpecifics?.chapters ? (
							<Text color="dimmed">
								{" "}
								• {userMediaDetails.data.mediaDetails.mangaSpecifics.chapters}{" "}
								chapters
							</Text>
						) : null}
						{userMediaDetails.data.mediaDetails.mangaSpecifics?.volumes ? (
							<Text color="dimmed">
								{" "}
								• {userMediaDetails.data.mediaDetails.mangaSpecifics.volumes}{" "}
								volumes
							</Text>
						) : null}
						{userMediaDetails.data.mediaDetails.movieSpecifics?.runtime ? (
							<Text color="dimmed">
								{" "}
								•{" "}
								{humaizer.humanize(
									userMediaDetails.data.mediaDetails.movieSpecifics.runtime *
										1000 *
										60,
								)}
							</Text>
						) : null}
						{userMediaDetails.data.mediaDetails.showSpecifics ? (
							<Text color="dimmed">
								{" "}
								•{" "}
								{
									userMediaDetails.data.mediaDetails.showSpecifics.seasons
										.length
								}{" "}
								seasons
							</Text>
						) : null}
						{userMediaDetails.data.mediaDetails.audioBookSpecifics?.runtime ? (
							<Text color="dimmed">
								{" "}
								•{" "}
								{humaizer.humanize(
									userMediaDetails.data.mediaDetails.audioBookSpecifics
										.runtime *
										1000 *
										60,
								)}
							</Text>
						) : null}
						{userMediaDetails.data.mediaDetails.publishYear ? (
							<Text color="dimmed">
								{" "}
								• {userMediaDetails.data.mediaDetails.publishYear}
							</Text>
						) : null}
					</Flex>
					{userMediaDetails.data.inProgress ? (
						<Alert icon={<IconAlertCircle size="1rem" />} variant="outline">
							You are currently{" "}
							{getVerb(Verb.Read, userMediaDetails.data.mediaDetails.lot)}
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
							{userMediaDetails.data.mediaDetails.showSpecifics ? (
								<Tabs.Tab value="seasons" icon={<IconPlayerPlay size="1rem" />}>
									Seasons
								</Tabs.Tab>
							) : null}
							{userMediaDetails.data.mediaDetails.podcastSpecifics ? (
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
									{userMediaDetails.data.mediaDetails.description ? (
										<Text
											dangerouslySetInnerHTML={{
												__html: userMediaDetails.data.mediaDetails.description,
											}}
										/>
									) : (
										<Text fs="italic">No overview available</Text>
									)}
									<Box mt="xl">
										{Object.keys(creators).map((c) => (
											<Spoiler
												maxHeight={50}
												showLabel="Show more"
												hideLabel="Hide"
												key={c}
												my="xs"
											>
												<Flex>
													<Text span>
														<Text fw="bold" span>
															{c}
														</Text>
														: {creators[c].map((a) => a.name).join(", ")}
													</Text>
												</Flex>
											</Spoiler>
										))}
									</Box>
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
												lot={userMediaDetails.data.mediaDetails.lot}
												total={
													userMediaDetails.data.mediaDetails.audioBookSpecifics
														?.runtime ||
													userMediaDetails.data.mediaDetails.bookSpecifics
														?.pages ||
													userMediaDetails.data.mediaDetails.movieSpecifics
														?.runtime ||
													userMediaDetails.data.mediaDetails.mangaSpecifics
														?.chapters ||
													userMediaDetails.data.mediaDetails.animeSpecifics
														?.episodes
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
												I finished{" "}
												{getVerb(
													Verb.Read,
													userMediaDetails.data.mediaDetails.lot,
												)}
												ing it
											</Button>
										</>
									) : userMediaDetails.data.mediaDetails.lot ===
											MetadataLot.Show ||
									  userMediaDetails.data.mediaDetails.lot ===
											MetadataLot.Podcast ? (
										userMediaDetails.data.nextEpisode !== null ? (
											<Button
												variant="outline"
												onClick={async () => {
													if (
														userMediaDetails.data.mediaDetails.lot ===
														MetadataLot.Podcast
													)
														router.push(
															withQuery(
																ROUTES.media.individualMedia.updateProgress,
																{
																	item: metadataId,
																	selectedPodcastEpisodeNumber:
																		userMediaDetails.data.nextEpisode
																			?.episodeNumber,
																},
															),
														);
													else
														router.push(
															withQuery(
																ROUTES.media.individualMedia.updateProgress,
																{
																	item: metadataId,
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
												{userMediaDetails.data.mediaDetails.lot ===
												MetadataLot.Show
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
											I'm{" "}
											{getVerb(
												Verb.Read,
												userMediaDetails.data.mediaDetails.lot,
											)}
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
									) : userMediaDetails.data.mediaDetails.lot ===
											MetadataLot.Show ||
									  userMediaDetails.data.mediaDetails.lot ===
											MetadataLot.Podcast ? (
										<Button
											variant="outline"
											onClick={() => {
												if (
													userMediaDetails.data.mediaDetails.lot ===
													MetadataLot.Show
												)
													router.push(
														withQuery(
															ROUTES.media.individualMedia.updateProgress,
															{
																item: metadataId,
																completeShow: 1,
															},
														),
													);
												else
													router.push(
														withQuery(
															ROUTES.media.individualMedia.updateProgress,
															{
																item: metadataId,
																completePodcast: 1,
															},
														),
													);
											}}
										>
											Mark{" "}
											{changeCase(
												userMediaDetails.data.mediaDetails.lot,
											).toLowerCase()}{" "}
											as seen
										</Button>
									) : null}
									<Button
										variant="outline"
										onClick={() => {
											router.push(
												withQuery(ROUTES.media.individualMedia.updateProgress, {
													item: metadataId,
												}),
											);
										}}
									>
										Add to{" "}
										{getVerb(Verb.Read, userMediaDetails.data.mediaDetails.lot)}{" "}
										history
									</Button>
									<Link
										href={withQuery(ROUTES.media.individualMedia.postReview, {
											item: metadataId,
											showSeasonNumber:
												userMediaDetails.data.nextEpisode?.seasonNumber ??
												undefined,
											showEpisodeNumber:
												userMediaDetails.data.mediaDetails.lot ===
												MetadataLot.Show
													? userMediaDetails.data.nextEpisode?.episodeNumber ??
													  undefined
													: undefined,
											podcastEpisodeNumber:
												userMediaDetails.data.mediaDetails.lot ===
												MetadataLot.Podcast
													? userMediaDetails.data.nextEpisode?.episodeNumber ??
													  undefined
													: undefined,
										})}
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
										Seen by all users{" "}
										{userMediaDetails.data.mediaDetails.seenBy} time
										{userMediaDetails.data.mediaDetails.seenBy > 1 ? "s" : ""}{" "}
										and {userMediaDetails.data.history.length} time
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
						{userMediaDetails.data.mediaDetails.showSpecifics ? (
							<Tabs.Panel value="seasons">
								<MediaScrollArea>
									<Accordion chevronPosition="right" variant="contained">
										{userMediaDetails.data.mediaDetails.showSpecifics.seasons.map(
											(s) => (
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
															<Button
																variant="outline"
																onClick={() => {
																	router.push(
																		withQuery(
																			ROUTES.media.individualMedia
																				.updateProgress,
																			{
																				item: metadataId,
																				selectedShowSeasonNumber:
																					s.seasonNumber,
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
																						ROUTES.media.individualMedia
																							.updateProgress,
																						{
																							item: metadataId,
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
											),
										)}
									</Accordion>
								</MediaScrollArea>
							</Tabs.Panel>
						) : null}
						{userMediaDetails.data.mediaDetails.podcastSpecifics ? (
							<Tabs.Panel value="episodes">
								<MediaScrollArea>
									<Stack ml="md">
										{userMediaDetails.data.mediaDetails.podcastSpecifics.episodes.map(
											(e) => (
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
																	ROUTES.media.individualMedia.updateProgress,
																	{
																		item: metadataId,
																		selectedPodcastEpisodeNumber: e.number,
																	},
																),
															);
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
						<Tabs.Panel value="reviews">
							{userMediaDetails.data.reviews.length > 0 ? (
								<MediaScrollArea>
									<Stack>
										{userMediaDetails.data.reviews.map((r) => (
											<ReviewItem
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
