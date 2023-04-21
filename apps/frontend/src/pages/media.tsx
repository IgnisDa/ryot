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
	ScrollArea,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { BOOK_DETAILS } from "@trackona/graphql/backend/queries";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import ReactMarkdown from "react-markdown";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const itemId = router.query.item;
	const details = useQuery({
		queryKey: ["details", itemId],
		queryFn: async () => {
			const itemIdCast = parseInt(itemId?.toString() || "");
			const { bookDetails } = await gqlClient.request(BOOK_DETAILS, {
				metadataId: itemIdCast,
			});
			return bookDetails;
		},
		staleTime: Infinity,
	});

	return details.data ? (
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
								<Text fw="bold">Authors:</Text>
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
					{details.data.description && (
						<Box>
							<Title order={3}>Overview</Title>
							<ScrollArea h={300} pr={"sm"}>
								<ReactMarkdown>{details.data.description}</ReactMarkdown>
							</ScrollArea>
						</Box>
					)}
				</Stack>
			</Flex>
		</Container>
	) : null;
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
