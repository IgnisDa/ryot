import Grid from "@/components/Grid";
import { BaseDisplayItem } from "@/components/MediaComponents";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Center,
	Container,
	Pagination,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, snakeCase } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";
import { useCoreDetails } from "@/lib/hooks";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const genreId = parseInt(router.query.id?.toString() || "0");
	const [activePage, setPage] = useLocalStorage({
		defaultValue: 1,
		key: LOCAL_STORAGE_KEYS.savedGenreContentsPage,
		getInitialValueInEffect: false,
	});
	const coreDetails = useCoreDetails();

	const genreDetails = useQuery({
		queryKey: ["genreDetails", genreId, activePage],
		queryFn: async () => {
			const { genreDetails } = await gqlClient.request(GenreDetailsDocument, {
				input: {
					genreId,
					page: activePage || 1,
				},
			});
			return genreDetails;
		},
		staleTime: Infinity,
		enabled: !!genreId,
	});

	return coreDetails.data && genreDetails.data ? (
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
						{genreDetails.data.contents.items.map((media) => (
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
					<Center>
						<Pagination
							size="sm"
							value={activePage || 1}
							onChange={(v) => setPage(v)}
							total={Math.ceil(
								genreDetails.data.contents.details.total /
									coreDetails.data.pageLimit,
							)}
							boundaries={1}
							siblings={0}
						/>
					</Center>
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
