import type { NextPageWithLayout } from "../_app";
import { ROUTES } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getLot } from "@/lib/utilities";
import { Box, Container, Title } from "@mantine/core";
import {
	CommitAudioBookDocument,
	CommitBookDocument,
	type CommitBookMutationVariables,
	CommitMovieDocument,
	CommitPodcastDocument,
	CommitShowDocument,
	CommitVideoGameDocument,
	MetadataLot,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const lot = getLot(router.query.lot);
	const identifier = router.query.identifier?.toString();
	const next = router.query.next?.toString();

	const commitMedia = useMutation({
		mutationFn: async (variables: CommitBookMutationVariables) => {
			invariant(lot, "Lot must be defined");
			return await match(lot)
				.with(MetadataLot.AudioBook, async () => {
					const { commitAudioBook } = await gqlClient.request(
						CommitAudioBookDocument,
						variables,
					);
					return commitAudioBook;
				})
				.with(MetadataLot.Book, async () => {
					const { commitBook } = await gqlClient.request(
						CommitBookDocument,
						variables,
					);
					return commitBook;
				})
				.with(MetadataLot.Movie, async () => {
					const { commitMovie } = await gqlClient.request(
						CommitMovieDocument,
						variables,
					);
					return commitMovie;
				})
				.with(MetadataLot.Podcast, async () => {
					const { commitPodcast } = await gqlClient.request(
						CommitPodcastDocument,
						variables,
					);
					return commitPodcast;
				})
				.with(MetadataLot.Show, async () => {
					const { commitShow } = await gqlClient.request(
						CommitShowDocument,
						variables,
					);
					return commitShow;
				})
				.with(MetadataLot.VideoGame, async () => {
					const { commitVideoGame } = await gqlClient.request(
						CommitVideoGameDocument,
						variables,
					);
					return commitVideoGame;
				})
				.exhaustive();
		},
		onSuccess: (data) => {
			if (!next) router.push(`${ROUTES.media.details}?item=${data.id}`);
		},
	});

	useEffect(() => {
		if (identifier) commitMedia.mutate({ identifier });
	}, [identifier, lot]);

	return (
		<>
			<Head>
				<title>Loading | Ryot</title>
			</Head>
			<Container>
				<Box>
					<Title>Loading media details...</Title>
				</Box>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
