import type { NextPageWithLayout } from "../_app";
import Grid from "@/lib/components/Grid";
import { MediaItemWithoutUpdateModal } from "@/lib/components/MediaItem";
import { ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Container, Stack, Text, Title } from "@mantine/core";
import {
	CollectionContentsDocument,
	CollectionsDocument,
} from "@ryot/generated/graphql/backend/graphql";
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
			const { collections } = await gqlClient.request(CollectionsDocument, {});
			const currentCollection = collections.find((c) => c.id === collectionId)!;
			return { currentCollection, collectionContents };
		},
		{ enabled: !!collectionId },
	);

	return collectionId && collectionContents.data ? (
		<>
			<Head>
				<title>{collectionContents.data.currentCollection.name} | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Title>{collectionContents.data.currentCollection.name}</Title>
					{collectionContents.data.collectionContents.length > 0 ? (
						<>
							<Grid>
								{collectionContents.data.collectionContents.map((lm) => (
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
