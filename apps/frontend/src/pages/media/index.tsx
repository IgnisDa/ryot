import type { NextPageWithLayout } from "../_app";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Verb, getInitials, getVerb } from "@/lib/utilities";
import { Carousel } from "@mantine/carousel";
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
	Modal,
	Rating,
	ScrollArea,
	SimpleGrid,
	Slider,
	Space,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	type DeleteSeenItemMutationVariables,
	MetadataLot,
	ProgressUpdateAction,
	type ProgressUpdateMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import {
	DELETE_SEEN_ITEM,
	PROGRESS_UPDATE,
} from "@ryot/graphql/backend/mutations";
import {
	MEDIA_DETAILS,
	MEDIA_ITEM_REVIEWS,
	SEEN_HISTORY,
} from "@ryot/graphql/backend/queries";
import {
	IconAlertCircle,
	IconEdit,
	IconInfoCircle,
	IconMessageCircle2,
	IconPlayerPlay,
	IconRotateClockwise,
	IconUser,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import ReactMarkdown from "react-markdown";

const StatDisplay = (props: { name: string; value: string }) => {
	return (
		<Flex>
			<Text fw="bold">{props.name}:</Text>
			<Text truncate ml={"xs"}>
				{props.value}
			</Text>
		</Flex>
	);
};

export function ProgressModal(props: {
	opened: boolean;
	onClose: () => void;
	metadataId: number;
	progress: number;
	refetch: () => void;
}) {
	const [value, setValue] = useState(props.progress);
	const progressUpdate = useMutation({
		mutationFn: async (variables: ProgressUpdateMutationVariables) => {
			const { progressUpdate } = await gqlClient.request(
				PROGRESS_UPDATE,
				variables,
			);
			return progressUpdate;
		},
		onSuccess: () => {
			props.refetch();
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
			<Stack>
				<Title order={3}>Set progress</Title>
				<Slider showLabelOnHover={false} value={value} onChange={setValue} />
				<Button
					variant="outline"
					onClick={async () => {
						await progressUpdate.mutateAsync({
							input: {
								action: ProgressUpdateAction.Update,
								progress: value,
								metadataId: props.metadataId,
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
		</Modal>
	);
}

interface AccordionLabelProps {
	name: string;
	posterImages: string[];
	overview?: string | null;
}

export const AccordionLabel = ({
	name,
	posterImages,
	overview,
}: AccordionLabelProps) => {
	return (
		<Group noWrap>
			<Avatar src={posterImages[0]} radius="xl" size="lg" />
			<Box>
				<Text>{name}</Text>
				{overview ? (
					<Text size="sm" color="dimmed">
						{overview}
					</Text>
				) : null}
			</Box>
		</Group>
	);
};

const Page: NextPageWithLayout = () => {
	const [
		progressModalOpened,
		{ open: progressModalOpen, close: progressModalClose },
	] = useDisclosure(false);
	const router = useRouter();
	const metadataId = parseInt(router.query.item?.toString() || "0");
	const reviews = useQuery({
		queryKey: ["reviews", metadataId],
		queryFn: async () => {
			const { mediaItemReviews } = await gqlClient.request(MEDIA_ITEM_REVIEWS, {
				metadataId: metadataId,
			});
			return mediaItemReviews;
		},
		staleTime: Infinity,
	});
	const details = useQuery({
		queryKey: ["details", metadataId],
		queryFn: async () => {
			const { mediaDetails } = await gqlClient.request(MEDIA_DETAILS, {
				metadataId: metadataId,
			});
			return mediaDetails;
		},
		staleTime: Infinity,
	});
	const history = useQuery({
		queryKey: ["history", metadataId, details.data?.type],
		queryFn: async () => {
			const { seenHistory } = await gqlClient.request(SEEN_HISTORY, {
				metadataId: metadataId,
				isShow: details.data?.type === MetadataLot.Show,
			});
			return seenHistory;
		},
	});
	const progressUpdate = useMutation({
		mutationFn: async (variables: ProgressUpdateMutationVariables) => {
			const { progressUpdate } = await gqlClient.request(
				PROGRESS_UPDATE,
				variables,
			);
			return progressUpdate;
		},
		onSuccess: () => {
			history.refetch();
		},
	});
	const deleteSeenItem = useMutation({
		mutationFn: async (variables: DeleteSeenItemMutationVariables) => {
			const { deleteSeenItem } = await gqlClient.request(
				DELETE_SEEN_ITEM,
				variables,
			);
			return deleteSeenItem;
		},
		onSuccess: () => {
			history.refetch();
			notifications.show({ message: "Deleted successfully" });
		},
	});

	// it is the job of the backend to ensure that this has only one item
	const inProgressSeenItem = history.data?.find((h) => h.progress < 100);

	return details.data && history.data ? (
		<Container>
			<Flex direction={{ base: "column", md: "row" }} gap={"lg"}>
				<Stack
					sx={(t) => ({
						width: "100%",
						flex: "none",
						[t.fn.largerThan("md")]: { width: "35%" },
					})}
				>
					{details.data.posterImages.length > 0 ? (
						<Carousel
							withIndicators={details.data.posterImages.length > 1}
							withControls={details.data.posterImages.length > 1}
							w={300}
						>
							{[
								...details.data.posterImages,
								...details.data.backdropImages,
							].map((i) => (
								<Carousel.Slide key={i}>
									<Image src={i} radius={"lg"} />
								</Carousel.Slide>
							))}
						</Carousel>
					) : (
						<Box w={300}>
							<Image withPlaceholder height={400} radius={"lg"} />
						</Box>
					)}
					<Box>
						{details.data.type !== MetadataLot.Show &&
						details.data.creators.length > 0 ? (
							<StatDisplay
								name="Author(s)"
								value={details.data.creators.join(", ")}
							/>
						) : null}
						{details.data.genres.length > 0 ? (
							<StatDisplay
								name="Genre(s)"
								value={details.data.genres.join(", ")}
							/>
						) : null}
						{details.data.publishDate ? (
							<StatDisplay
								name="Published on"
								value={details.data.publishDate.toString()}
							/>
						) : details.data.publishYear ? (
							<StatDisplay
								name="Published in"
								value={details.data.publishYear.toString()}
							/>
						) : null}
						{details.data.bookSpecifics?.pages ? (
							<StatDisplay
								name="Number of pages"
								value={details.data.bookSpecifics.pages?.toString() || ""}
							/>
						) : null}
						{details.data.movieSpecifics?.runtime ? (
							<StatDisplay
								name="Runtime"
								value={
									`${details.data.movieSpecifics.runtime?.toString()} minutes` ||
									""
								}
							/>
						) : null}
					</Box>
				</Stack>
				<Stack style={{ flexGrow: 1 }}>
					<Title underline>{details.data.title}</Title>
					{inProgressSeenItem ? (
						<Alert icon={<IconAlertCircle size="1rem" />} variant="outline">
							You are currently {getVerb(Verb.Read, details.data.type)}ing this{" "}
							({inProgressSeenItem.progress}%)
						</Alert>
					) : null}
					<Tabs
						defaultValue={history.data.length > 0 ? "actions" : "overview"}
						variant="outline"
					>
						<Tabs.List>
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
							{details.data.showSpecifics ? (
								<Tabs.Tab value="seasons" icon={<IconPlayerPlay size="1rem" />}>
									Seasons
								</Tabs.Tab>
							) : null}
							<Tabs.Tab
								value="reviews"
								icon={<IconMessageCircle2 size="1rem" />}
							>
								Reviews
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="overview" pt="xs">
							<Box>
								{details.data.description ? (
									<ScrollArea.Autosize mah={300}>
										<ReactMarkdown>{details.data.description}</ReactMarkdown>
									</ScrollArea.Autosize>
								) : (
									<Text fs="italic">No overview available</Text>
								)}
							</Box>
						</Tabs.Panel>
						<Tabs.Panel value="actions" pt="xs">
							<SimpleGrid
								cols={1}
								spacing="lg"
								breakpoints={[{ minWidth: "md", cols: 2 }]}
							>
								{inProgressSeenItem ? (
									<>
										<Button variant="outline" onClick={progressModalOpen}>
											Set progress
										</Button>
										<ProgressModal
											progress={inProgressSeenItem.progress}
											refetch={history.refetch}
											metadataId={metadataId}
											onClose={progressModalClose}
											opened={progressModalOpened}
										/>
										<Button
											variant="outline"
											onClick={async () => {
												await progressUpdate.mutateAsync({
													input: {
														action: ProgressUpdateAction.Update,
														progress: 100,
														metadataId: metadataId,
													},
												});
											}}
										>
											I finished {getVerb(Verb.Read, details.data.type)}ing it
										</Button>
									</>
								) : details.data.type === MetadataLot.Show ? null : (
									<Button
										variant="outline"
										onClick={async () => {
											await progressUpdate.mutateAsync({
												input: {
													action: ProgressUpdateAction.JustStarted,
													metadataId: metadataId,
												},
											});
										}}
									>
										I'm {getVerb(Verb.Read, details.data.type)}ing it
									</Button>
								)}
								<Button
									variant="outline"
									onClick={() => {
										router.push(`/media/update-progress?item=${metadataId}`);
									}}
								>
									Add to {getVerb(Verb.Read, details.data.type)} history
								</Button>
								<Link
									href={`/media/post-review?item=${metadataId}`}
									passHref
									legacyBehavior
								>
									<Anchor>
										<Button variant="outline" w='100%'>
											Post a review
										</Button>
									</Anchor>
								</Link>
							</SimpleGrid>
						</Tabs.Panel>
						<Tabs.Panel value="history" pt="xs">
							{history.data.length > 0 ? (
								<ScrollArea.Autosize mah={300}>
									<Stack>
										<Text>{history.data.length} elements in history</Text>
										{history.data.map((h) => (
											<Flex key={h.id} direction={"column"} ml="md">
												<Flex gap="xl">
													{h.progress < 100 ? (
														<Text fw="bold">Progress {h.progress}%</Text>
													) : (
														<Text fw="bold">Completed</Text>
													)}
													{h.showInformation ? (
														<Text color="dimmed">
															S{h.showInformation.season}-E
															{h.showInformation.episode}
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
										))}
									</Stack>
								</ScrollArea.Autosize>
							) : (
								<Text fs="italic">You have no history for this item</Text>
							)}
						</Tabs.Panel>
						{details.data.showSpecifics ? (
							<Tabs.Panel value="seasons" pt="xs">
								<ScrollArea.Autosize mah={300}>
									<Accordion chevronPosition="right" variant="contained">
										{details.data.showSpecifics.seasons.map((s) => (
											<Accordion.Item
												value={s.seasonNumber.toString()}
												key={s.seasonNumber}
											>
												<Accordion.Control>
													<Flex
														align={"center"}
														justify={"space-between"}
														gap={"xs"}
													>
														<AccordionLabel
															{...s}
															name={`${s.seasonNumber}. ${s.name}`}
														/>
														<Button
															variant="outline"
															onClick={() => {
																router.push(
																	`/media/update-progress?item=${metadataId}&selectedSeason=${s.seasonNumber}&onlySeason=1`,
																);
															}}
														>
															Mark as seen
														</Button>
													</Flex>
												</Accordion.Control>
												<Accordion.Panel>
													{s.episodes.map((e) => (
														<Flex
															mb={"xs"}
															ml={"md"}
															justify={"space-between"}
															align={"center"}
															gap={"xs"}
														>
															<AccordionLabel
																{...e}
																key={e.episodeNumber}
																name={`${e.episodeNumber}. ${e.name}`}
															/>
															<Button
																variant="outline"
																onClick={() => {
																	router.push(
																		`/media/update-progress?item=${metadataId}&selectedSeason=${s.seasonNumber}&selectedEpisode=${e.episodeNumber}`,
																	);
																}}
															>
																Mark as seen
															</Button>
														</Flex>
													))}
												</Accordion.Panel>
											</Accordion.Item>
										))}
									</Accordion>
								</ScrollArea.Autosize>
							</Tabs.Panel>
						) : null}
						<Tabs.Panel value="reviews" pt="xs">
							{reviews.data && reviews.data.length > 0 ? (
								<Stack>
									<ScrollArea.Autosize mah={300}>
										{reviews.data.map((r) => (
											<Box key={r.id}>
												<Flex align={"center"} gap={"sm"}>
													<Avatar color="cyan" radius="xl">
														{getInitials(r.postedBy.name)}{" "}
													</Avatar>
													<Box>
														<Text>{r.postedBy.name}</Text>
														<Text>
															{DateTime.fromJSDate(r.postedOn).toLocaleString()}
														</Text>
													</Box>
													{/* TODO: Render this element on when it is the currently logged in user */}
													<ActionIcon>
														<IconEdit size="1rem" />
													</ActionIcon>
												</Flex>
												<Box ml={"sm"} mt={"xs"}>
													{r.rating ? (
														<Rating
															value={Number(r.rating)}
															fractions={2}
															readOnly
														/>
													) : null}
													<Space h="xs" />
													{r.text ? <Text>{r.text}</Text> : null}
												</Box>
											</Box>
										))}
									</ScrollArea.Autosize>
								</Stack>
							) : (
								<Text fs="italic">No reviews posted</Text>
							)}
						</Tabs.Panel>
					</Tabs>
				</Stack>
			</Flex>
		</Container>
	) : null;
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
