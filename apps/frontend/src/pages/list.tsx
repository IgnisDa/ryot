import type { NextPageWithLayout } from "./_app";
import MediaItem, {
	MediaItemWithoutUpdateModal,
} from "@/lib/components/MediaItem";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getLot } from "@/lib/utilities";
import {
	Center,
	Container,
	Pagination,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { MetadataLot } from "@trackona/generated/graphql/backend/graphql";
import {
	BOOKS_SEARCH,
	MEDIA_LIST,
	MOVIES_SEARCH,
} from "@trackona/graphql/backend/queries";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import { match } from "ts-pattern";

const LIMIT = 20;

const Grid = (props: { children: JSX.Element }) => {
	return (
		<SimpleGrid
			cols={2}
			spacing="lg"
			mx={"lg"}
			breakpoints={[
				{ minWidth: "sm", cols: 3 },
				{ minWidth: "md", cols: 4 },
				{ minWidth: "lg", cols: 5 },
				{ minWidth: "xl", cols: 6 },
			]}
		>
			{props.children}
		</SimpleGrid>
	);
};

const Page: NextPageWithLayout = () => {
	const [query, setQuery] = useLocalStorage({
		key: "savedQuery",
	});
	const [activePage, setPage] = useLocalStorage({
		key: "savedPage",
	});
	const router = useRouter();
	const lot = getLot(router.query.lot);
	const offset = (parseInt(activePage) - 1) * LIMIT;
	const listMedia = useQuery(
		["listMedia", activePage, lot],
		async () => {
			if (!lot) throw Error();
			const { mediaList } = await gqlClient.request(MEDIA_LIST, {
				input: { lot, page: parseInt(activePage) },
			});
			return mediaList;
		},
		{ enabled: lot !== undefined && query === "", staleTime: Infinity },
	);
	const searchQuery = useQuery(
		["searchQuery", activePage, lot, query],
		async () => {
			return await match(lot)
				.with(MetadataLot.Book, async () => {
					const { booksSearch } = await gqlClient.request(BOOKS_SEARCH, {
						input: { query, offset },
					});
					return booksSearch;
				})
				.with(MetadataLot.Movie, async () => {
					const { moviesSearch } = await gqlClient.request(MOVIES_SEARCH, {
						input: { query, page: parseInt(activePage) },
					});
					return moviesSearch;
				})
				.otherwise(async () => {
					throw new Error("Unreachable!");
				});
		},
		{ enabled: query !== "" && lot !== undefined, staleTime: Infinity },
	);

	return lot ? (
		<Container>
			<Stack>
				<TextInput
					name="query"
					placeholder={`Search for a ${lot.toLowerCase()}`}
					icon={<IconSearch />}
					defaultValue={query}
					style={{ flexGrow: 1 }}
					onChange={(e) => setQuery(e.currentTarget.value)}
				/>
				<Grid>
					<>
						{listMedia.data && listMedia.data.total > 0
							? listMedia.data.items.map((lm, idx) => (
									<MediaItemWithoutUpdateModal
										key={idx}
										item={lm}
										lot={lot}
										imageOnClick={async () => parseInt(lm.identifier)}
									/>
							  ))
							: null}
						{searchQuery.data && searchQuery.data.total > 0 ? (
							<>
								{searchQuery.data.items.map((b, idx) => (
									<MediaItem
										idx={idx}
										key={idx}
										item={b}
										query={query}
										offset={offset}
										lot={lot}
										refetch={searchQuery.refetch}
									/>
								))}
							</>
						) : (
							<Text>No media found :(</Text>
						)}
					</>
				</Grid>
				{(searchQuery.data || listMedia.data) && (
					<Center>
						<Pagination
							size="sm"
							value={parseInt(activePage)}
							onChange={(v) => setPage(v.toString())}
							total={Math.ceil(
								(searchQuery.data?.total || listMedia.data?.total || 0) / LIMIT,
							)}
							boundaries={1}
							siblings={0}
						/>
					</Center>
				)}
			</Stack>
		</Container>
	) : null;
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
