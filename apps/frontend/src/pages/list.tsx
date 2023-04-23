import type { NextPageWithLayout } from "./_app";
import SearchMedia from "@/lib/components/SearchMedia";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getLot } from "@/lib/utilities";
import {
	Box,
	Button,
	Center,
	Container,
	Loader,
	Pagination,
	SimpleGrid,
	Space,
	Stack,
	TextInput,
} from "@mantine/core";
import { useDebouncedState } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { MetadataLot } from "@trackona/generated/graphql/backend/graphql";
import { BOOKS_SEARCH, MOVIES_SEARCH } from "@trackona/graphql/backend/queries";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { match } from "ts-pattern";

const LIMIT = 20;

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const lot = getLot(router.query.lot);
	const _query = (router.query.query || "").toString();
	const [query, setQuery] = useDebouncedState(_query, 1000);
	const [activePage, setPage] = useState(1);
	const offset = (activePage - 1) * LIMIT;
	const searchQuery = useQuery(
		["searchQuery", query, activePage, lot],
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
						input: { query, page: activePage },
					});
					return moviesSearch;
				})
				.otherwise(async () => {
					throw new Error("Unreachable!");
				});
		},
		{ enabled: query !== "" && lot !== undefined, staleTime: Infinity },
	);

	useEffect(() => {
		setQuery(_query);
	}, [router]);

	return lot ? (
		<Container>
			<Stack>
				<Box component="form" w="100%" style={{ display: "flex" }}>
					<TextInput
						name="query"
						placeholder={`Search for a ${lot.toLowerCase()}`}
						icon={<IconSearch />}
						rightSection={searchQuery.isFetching ? <Loader size="xs" /> : null}
						defaultValue={query}
						style={{ flexGrow: 1 }}
						onChange={(e) => setQuery(e.currentTarget.value)}
					/>
					<input hidden name="lot" value={router.query.lot} />
					<Space w="sm" />
					<Button type="submit" variant="light">
						Submit
					</Button>
				</Box>
				{searchQuery.data && searchQuery.data.total > 0 ? (
					<>
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
							{searchQuery.data.items.map((b, idx) => (
								<SearchMedia
									idx={idx}
									key={idx}
									item={b}
									query={query}
									offset={offset}
									lot={lot}
									refetch={searchQuery.refetch}
								/>
							))}
						</SimpleGrid>
						<Center>
							<Pagination
								size="sm"
								value={activePage}
								onChange={setPage}
								total={Math.ceil(searchQuery.data.total / LIMIT)}
								boundaries={1}
								siblings={0}
							/>
						</Center>
					</>
				) : null}
			</Stack>
		</Container>
	) : null;
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
