import type { NextPageWithLayout } from "./_app";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Box, Container, Flex, SimpleGrid, Text, Title } from "@mantine/core";
import { PartialCollectionsDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const collections = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(PartialCollectionsDocument);
		return collections;
	});

	return collections.data ? (
		<>
			<Head>
				<title>Collections | Ryot</title>
			</Head>
			<Container>
				<SimpleGrid cols={2} breakpoints={[{ minWidth: "lg", cols: 3 }]}>
					{collections.data.map((c) => (
						<Box key={c.collectionDetails.id}>
							<Flex align={"center"} gap="xs">
								<Title order={3}>{c.collectionDetails.name}</Title>
								<Text color="dimmed" size={"xs"}>
									({c.collectionDetails.numItems})
								</Text>
							</Flex>
						</Box>
					))}
				</SimpleGrid>
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
