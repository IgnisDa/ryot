import type { NextPageWithLayout } from "../_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import { ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Box, Container, Flex, Stack, Text, Title } from "@mantine/core";
import { CollectionContentsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/utilities";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const collectionId = parseInt(router.query.collectionId?.toString() || "0");

	const collectionContents = useQuery(
		["collectionContents"],
		async () => {
			const { collectionContents } = await gqlClient.request(
				CollectionContentsDocument,
				{ input: { collectionId } },
			);
			return collectionContents;
		},
		{ enabled: !!collectionId },
	);

	return collectionId && collectionContents.data ? (
		<>
			<Head>
				<title>{collectionContents.data.collectionDetails.name} | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Box>
						<Text color="dimmed" size="xs" mb={-10}>
							{changeCase(collectionContents.data.collectionDetails.visibility)}
						</Text>
						<Title>{collectionContents.data.collectionDetails.name}</Title>
					</Box>
					<Text>{collectionContents.data.collectionDetails.description}</Text>
					{collectionContents.data.media.length > 0 ? (
						<>
							<Grid>
								{collectionContents.data.media.map((lm) => (
									<MediaItemWithoutUpdateModal
										key={lm.identifier}
										item={lm}
										lot={lm.lot}
										href={`${ROUTES.media.details}?item=${lm.identifier}`}
									/>
								))}
							</Grid>
						</>
					) : (
						<Text>You have not added any media to this collection</Text>
					)}
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
