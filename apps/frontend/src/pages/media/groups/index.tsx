import {
	MediaScrollArea,
	PartialMetadataDisplay,
} from "@/lib/components/MediaComponents";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Container, Flex, SimpleGrid, Text, Title } from "@mantine/core";
import { MetadataGroupDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const metadataGroupId = parseInt(router.query.id?.toString() || "0");

	const groupDetails = useQuery({
		queryKey: ["groupDetails", metadataGroupId],
		queryFn: async () => {
			const { metadataGroupDetails } = await gqlClient.request(
				MetadataGroupDetailsDocument,
				{ metadataGroupId },
			);
			return metadataGroupDetails;
		},
		staleTime: Infinity,
		enabled: !!metadataGroupId,
	});

	return groupDetails.data ? (
		<>
			<Head>
				<title>{groupDetails.data.details.title} | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					images={groupDetails.data.details.displayImages}
					externalLink={{
						source: groupDetails.data.details.source,
						lot: groupDetails.data.details.lot,
						href: groupDetails.data.sourceUrl,
					}}
				>
					<Title id="group-title">{groupDetails.data.details.title}</Title>
					<Flex id="group-details" wrap={"wrap"} gap={4}>
						<Text>{groupDetails.data.details.parts} media items</Text>
					</Flex>
					<MediaScrollArea>
						<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
							{groupDetails.data.contents.map((media) => (
								<PartialMetadataDisplay key={media.identifier} media={media} />
							))}
						</SimpleGrid>
					</MediaScrollArea>
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
