import { PartialMetadataDisplay } from "@/components/MediaComponents";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Container, Flex, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const genreId = parseInt(router.query.id?.toString() || "0");

	const genreDetails = useQuery({
		queryKey: ["genreDetails", genreId],
		queryFn: async () => {
			const { genreDetails } = await gqlClient.request(GenreDetailsDocument, {
				genreId,
			});
			return genreDetails;
		},
		staleTime: Infinity,
		enabled: !!genreId,
	});

	return genreDetails.data ? (
		<>
			<Head>
				<title>{genreDetails.data.details.name} | Ryot</title>
			</Head>
			<Container size="sm">
				<Stack>
					<Title id="group-title">{genreDetails.data.details.name}</Title>
					<Flex id="group-details" wrap="wrap" gap={4}>
						<Text>{genreDetails.data.details.numItems} media items</Text>
					</Flex>
					<SimpleGrid cols={{ base: 3, md: 4, lg: 5, xl: 6 }}>
						{genreDetails.data.contents.map((media) => (
							<PartialMetadataDisplay
								key={media.identifier}
								media={
									// biome-ignore lint/suspicious/noExplicitAny: required here
									{ ...media, metadataId: Number(media.identifier) } as any
								}
							/>
						))}
					</SimpleGrid>
				</Stack>
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
