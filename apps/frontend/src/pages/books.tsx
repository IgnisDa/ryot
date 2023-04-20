import LoggedIn from "@/lib/layouts/LoggedIn";
import type { NextPageWithLayout } from "./_app";
import { useState, type ReactElement } from "react";
import {
	Image,
	Text,
	Center,
	Container,
	Loader,
	Pagination,
	SimpleGrid,
	Stack,
	TextInput,
	Flex,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { gqlClient } from "@/lib/services/api";
import { BOOKS_SEARCH } from "@trackona/graphql/backend/queries";
import { useDebouncedState } from "@mantine/hooks";
import { COMMIT_BOOK } from "@trackona/graphql/backend/mutations";
import type { CommitBookMutationVariables } from "@trackona/generated/graphql/backend/graphql";
import { useRouter } from "next/router";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const [query, setQuery] = useDebouncedState("", 1000);
	const [activePage, setPage] = useState(1);
	const offset = (activePage - 1) * 20;
	const searchQuery = useQuery(
		["searchQuery", query, activePage],
		async () => {
			const { booksSearch } = await gqlClient.request(BOOKS_SEARCH, {
				input: { query, offset },
			});
			return booksSearch;
		},
		{ enabled: query !== "" },
	);
	const commitBook = useMutation(
		async (variables: CommitBookMutationVariables) => {
			const { commitBook } = await gqlClient.request(COMMIT_BOOK, variables);
			return commitBook;
		},
	);

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
							{searchQuery.data.books.map((b, idx) => (
								<Flex
									key={b.identifier}
									align={"center"}
									justify={"center"}
									direction={"column"}
								>
									<Image
										src={b.images.at(0)}
										radius={"md"}
										height={250}
										withPlaceholder
										placeholder={<Text size={60}>?</Text>}
										style={{ cursor: "pointer" }}
										alt={`Image for ${b.title}`}
										onClick={async () => {
											const { id } = await commitBook.mutateAsync({
												identifier: b.identifier,
												index: idx,
												input: { query, offset },
											});
											router.push(`/media/${id}`);
										}}
									/>
									<Flex justify={"space-between"} w="100%">
										<Text c="dimmed">{b.publishYear}</Text>
										<Text c="dimmed">Book</Text>
									</Flex>
									<Text w="100%" truncate fw={"bold"}>
										{b.title}
									</Text>
								</Flex>
							))}
						</SimpleGrid>
						<Center>
							<Pagination
								size="sm"
								value={activePage}
								onChange={setPage}
								total={Math.ceil(
									searchQuery.data.total / searchQuery.data.limit,
								)}
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
