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
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { BOOK_DETAILS } from "@trackona/graphql/backend/queries";
import { useRouter } from "next/router";
import { type ReactElement } from "react";

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
				<Group>
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
				</Group>
				<Stack>
					<Title>{details.data.title}</Title>
					{details.data.description && <Text>{details.data.description}</Text>}
				</Stack>
			</Flex>
		</Container>
	) : null;
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
