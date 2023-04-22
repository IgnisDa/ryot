import type { NextPageWithLayout } from "./_app";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Carousel } from "@mantine/carousel";
import {
	Box,
	Container,
	Flex,
	Group,
	Image,
	List,
	ScrollArea,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import {
	IconInfoCircle,
	IconRotateClockwise,
	IconUser,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { type SeenHistoryQuery } from "@trackona/generated/graphql/backend/graphql";
import { BOOK_DETAILS, SEEN_HISTORY } from "@trackona/graphql/backend/queries";
import { DateTime } from "luxon";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import ReactMarkdown from "react-markdown";

const seenStatus = (seen: SeenHistoryQuery["seenHistory"][number]) => {
	const startedOn = seen.startedOn ? DateTime.fromJSDate(seen.startedOn) : null;
	const finishedOn = seen.finishedOn
		? DateTime.fromJSDate(seen.finishedOn)
		: null;
	const updatedOn = DateTime.fromJSDate(seen.lastUpdatedOn);
	if (startedOn && finishedOn)
		return `Started on ${startedOn.toLocaleString()} and finished on ${finishedOn.toLocaleString()}`;
	else if (finishedOn) return `Finished on ${finishedOn.toLocaleString()}`;
	return `You read it on ${updatedOn.toLocaleString()}`;
};

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const itemId = parseInt(router.query.item?.toString() || "0");
	const details = useQuery({
		queryKey: ["details", itemId],
		queryFn: async () => {
			const { bookDetails } = await gqlClient.request(BOOK_DETAILS, {
				metadataId: itemId,
			});
			return bookDetails;
		},
		staleTime: Infinity,
	});
	const history = useQuery({
		queryKey: ["history", itemId],
		queryFn: async () => {
			const { seenHistory } = await gqlClient.request(SEEN_HISTORY, {
				metadataId: itemId,
			});
			return seenHistory;
		},
		staleTime: Infinity,
	});
	return details.data && history.data ? (
		<Container>
			<Flex direction={{ base: "column", md: "row" }} gap={"lg"}>
				<Stack>
					{details.data.images.length > 0 ? (
						<Carousel
							withIndicators
							height={400}
							w={300}
							mx={"auto"}
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
							<Group>
								<Text fw="bold">Author(s):</Text>
								<Text>{details.data.creators.join(", ")}</Text>
							</Group>
						)}
						{details.data.publishYear && (
							<Group>
								<Text fw="bold">Published in:</Text>
								<Text>{details.data.publishYear}</Text>
							</Group>
						)}
						{details.data.specifics.pages && (
							<Group>
								<Text fw="bold">Number of pages:</Text>
								<Text>{details.data.specifics.pages}</Text>
							</Group>
						)}
					</Box>
				</Stack>
				<Stack>
					<Title underline>{details.data.title}</Title>
					<Tabs
						defaultValue={history.data.length > 0 ? "history" : "overview"}
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
							{details.data.description && (
								<Box>
									<ScrollArea.Autosize mah={300}>
										<ReactMarkdown>{details.data.description}</ReactMarkdown>
									</ScrollArea.Autosize>
								</Box>
							)}
						</Tabs.Panel>
						<Tabs.Panel value="actions" pt="xs">
							<Box>
								<Text>Actions</Text>
							</Box>
						</Tabs.Panel>
						<Tabs.Panel value="history" pt="xs">
							<>
								<List type="ordered">
									{history.data?.map((h) => (
										<List.Item key={h.id}>{seenStatus(h)}</List.Item>
									))}
								</List>
							</>
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
