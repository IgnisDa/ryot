import Grid from "@/components/Grid";
import { BaseDisplayItem } from "@/components/MediaComponents";
import { APP_ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Box, Container, Stack, Text, Title } from "@mantine/core";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, snakeCase } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { withQuery } from "ufo";
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
			<Container>
				<Stack>
					<Box>
						<Title id="genre-title">{genreDetails.data.details.name}</Title>
						<Text>{genreDetails.data.details.numItems} media items</Text>
					</Box>
					<Grid>
						{genreDetails.data.contents.map((media) => (
							<BaseDisplayItem
								key={media.details.identifier}
								name={media.details.title}
								bottomLeft={media.details.publishYear}
								bottomRight={changeCase(snakeCase(media.metadataLot || ""))}
								imageLink={media.details.image}
								imagePlaceholder={getInitials(media.details.title)}
								href={withQuery(APP_ROUTES.media.individualMediaItem.details, {
									id: media.details.identifier,
								})}
							/>
						))}
					</Grid>
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
