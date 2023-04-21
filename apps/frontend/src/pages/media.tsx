import type { NextPageWithLayout } from "./_app";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Container, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { MetadataLot } from "@trackona/generated/graphql/backend/graphql";
import { BOOK_DETAILS } from "@trackona/graphql/backend/queries";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import { match } from "ts-pattern";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const itemId = router.query.item;
	const lot = match(router.query.lot)
		.with("books", () => MetadataLot.Book)
		.with("movies", () => MetadataLot.Movie)
		.with("games", () => MetadataLot.VideoGame)
		.with("tv", () => MetadataLot.Show)
		.with("audiobooks", () => MetadataLot.AudioBook)
		.otherwise(() => MetadataLot.Book);
	const details = useQuery({
		queryKey: ["details"],
		queryFn: async () => {
			const itemIdCast = parseInt(itemId?.toString() || "");
			const { bookDetails } = await gqlClient.request(BOOK_DETAILS, {
				metadataId: itemIdCast,
			});
			return bookDetails;
		},
	});

	return (
		<Container>
			<Stack>
				{lot}
				{JSON.stringify(details.data)}
			</Stack>
		</Container>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
