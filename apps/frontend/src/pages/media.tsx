import type { NextPageWithLayout } from "./_app";
import UpdateProgressModal from "@/lib/components/UpdateProgressModal";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Verb, getVerb } from "@/lib/utilities";
import { Carousel } from "@mantine/carousel";
import {
	Alert,
	Box,
	Button,
	Container,
	Flex,
	Image,
	List,
	Modal,
	ScrollArea,
	SimpleGrid,
	Slider,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	IconAlertCircle,
	IconInfoCircle,
	IconRotateClockwise,
	IconUser,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	MetadataLot,
	ProgressUpdateAction,
	type ProgressUpdateMutationVariables,
	type SeenHistoryQuery,
} from "@trackona/generated/graphql/backend/graphql";
import { PROGRESS_UPDATE } from "@trackona/graphql/backend/mutations";
import { MEDIA_DETAILS, SEEN_HISTORY } from "@trackona/graphql/backend/queries";
import { DateTime } from "luxon";
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

const seenStatus = (
	seen: SeenHistoryQuery["seenHistory"][number],
	lot: MetadataLot,
) => {
	const startedOn = seen.startedOn ? DateTime.fromISO(seen.startedOn) : null;
	const finishedOn = seen.finishedOn ? DateTime.fromISO(seen.finishedOn) : null;
	const updatedOn = DateTime.fromJSDate(seen.lastUpdatedOn);
	if (seen.progress === 100) {
		if (startedOn && finishedOn)
			return `Started on ${startedOn.toLocaleString()} and finished on ${finishedOn.toLocaleString()}`;
		else if (finishedOn) return `Finished on ${finishedOn.toLocaleString()}`;
		return `You ${getVerb(
			Verb.Read,
			lot,
		)} it on ${updatedOn.toLocaleString()} (not remembered)`;
	} else return `Started on ${startedOn?.toLocaleString()} (${seen.progress}%)`;
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

const Page: NextPageWithLayout = () => {
	const [opened, { open, close }] = useDisclosure(false);
	const [newModalOpened, { open: openNewModal, close: closeNewModal }] =
		useDisclosure(false);
	const router = useRouter();
	const metadataId = parseInt(router.query.item?.toString() || "0");
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
		queryKey: ["history", metadataId],
		queryFn: async () => {
			const { seenHistory } = await gqlClient.request(SEEN_HISTORY, {
				metadataId: metadataId,
			});
			return seenHistory;
		},
		staleTime: Infinity,
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

	// it is the job of the backend to ensure that this has only one item
	const inProgressSeenItem = history.data?.find((h) => h.progress < 100);

	return details.data && history.data ? (
		<Container>
			<Flex direction={{ base: "column", md: "row" }} gap={"lg"}>
				<Stack
					sx={(t) => ({
						width: "100%",
						[t.fn.largerThan("md")]: { width: "35%" },
					})}
				>
					{details.data.images.length > 0 ? (
						<Carousel
							withIndicators
							height={400}
							w={300}
							data-num-images={details.data.images.length}
						>
							{details.data.images.map((i) => (
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
						{details.data.creators.length > 0 && (
							<StatDisplay
								name="Author(s)"
								value={details.data.creators.join(", ")}
							/>
						)}
						{details.data.publishYear && (
							<StatDisplay
								name="Published in"
								value={details.data.publishYear.toString()}
							/>
						)}
						{details.data.bookSpecifics && (
							<StatDisplay
								name="Number of pages"
								value={details.data.bookSpecifics.pages?.toString() || ""}
							/>
						)}
						{details.data.movieSpecifics && (
							<StatDisplay
								name="Runtime"
								value={
									`${details.data.movieSpecifics.runtime?.toString()} minutes` || ""
								}
							/>
						)}
					</Box>
				</Stack>
				<Stack style={{ flexGrow: 1 }}>
					<Title underline>{details.data.title}</Title>
					{inProgressSeenItem ? (
						<Alert icon={<IconAlertCircle size="1rem" />} variant="outline">
							You are currently {getVerb(Verb.Read, details.data.type)}ing this{" "}
							{details.data.type.toLowerCase()} ({inProgressSeenItem.progress}
							%)
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
								mx={"lg"}
								breakpoints={[{ minWidth: "md", cols: 2 }]}
							>
								{inProgressSeenItem ? (
									<>
										<Button variant="outline" onClick={open}>
											Set progress
										</Button>
										<ProgressModal
											progress={inProgressSeenItem.progress}
											refetch={history.refetch}
											metadataId={metadataId}
											onClose={close}
											opened={opened}
										/>
									</>
								) : (
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
										I am {getVerb(Verb.Read, details.data.type)}ing it
									</Button>
								)}
								<>
									<Button variant="outline" onClick={openNewModal}>
										Add to {getVerb(Verb.Read, details.data.type)} history
									</Button>
									<UpdateProgressModal
										title={details.data.title}
										lot={details.data.type}
										metadataId={metadataId}
										onClose={closeNewModal}
										opened={newModalOpened}
										refetch={history.refetch}
									/>
								</>
							</SimpleGrid>
						</Tabs.Panel>
						<Tabs.Panel value="history" pt="xs">
							{history.data.length > 0 ? (
								<List type="ordered">
									{history.data.map((h) => (
										<List.Item key={h.id}>
											{seenStatus(h, details.data.type)}
										</List.Item>
									))}
								</List>
							) : (
								<Text fs="italic">You have no history for this item</Text>
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
