import LoggedIn from "@/lib/layouts/LoggedIn";
import type { NextPageWithLayout } from "./_app";
import { useState, type ReactElement, useEffect } from "react";
import {
	Center,
	Container,
	Loader,
	Pagination,
	SimpleGrid,
	Stack,
	TextInput,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { gqlClient } from "@/lib/services/api";
import { useDebouncedState } from "@mantine/hooks";
import { useRouter } from "next/router";
import SearchMedia from "@/lib/components/SearchMedia";
import type {
	CommitBookMutationVariables,
	MetadataLot,
} from "@trackona/generated/graphql/backend/graphql";
import { COMMIT_BOOK } from "@trackona/graphql/backend/mutations";
import { BOOKS_SEARCH } from "@trackona/graphql/backend/queries";

const LIMIT = 20;

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const lot = router.query.lot as MetadataLot;
	const [query, setQuery] = useDebouncedState("", 1000);
	const [activePage, setPage] = useState(1);
	const offset = (activePage - 1) * LIMIT;
	const searchQuery = useQuery(
		["searchQuery", query, activePage],
		async () => {
			const { booksSearch } = await gqlClient.request(BOOKS_SEARCH, {
				input: { query, offset },
			});
			return booksSearch;
		},
		{ enabled: query !== "", staleTime: Infinity },
	);
	const commitBook = useMutation(
		async (variables: CommitBookMutationVariables) => {
			const { commitBook } = await gqlClient.request(COMMIT_BOOK, variables);
			return commitBook;
		},
	);
	useEffect(() => {
		if (!lot) router.push("/");
	}, []);

	return (
		<Container>
			<Stack>
				<TextInput
					placeholder="Search for a book"
					icon={<IconSearch />}
					rightSection={searchQuery.isFetching ? <Loader size="xs" /> : null}
					defaultValue={query}
					onChange={(e) => setQuery(e.currentTarget.value)}
				/>
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
									onClick={async () => {
										const { id } = await commitBook.mutateAsync({
											identifier: b.identifier,
											index: idx,
											input: { query, offset },
										});
										router.push(`/media?item=${id}&lot=${lot}`);
									}}
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
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
