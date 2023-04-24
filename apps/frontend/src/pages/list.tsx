import type { NextPageWithLayout } from "./_app";
import MediaItem, {
	MediaItemWithoutUpdateModal,
} from "@/lib/components/MediaItem";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getLot } from "@/lib/utilities";
import {
	ActionIcon,
	Box,
	Center,
	Container,
	Pagination,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	TextInput,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { IconListCheck, IconRefresh, IconSearch } from "@tabler/icons-react";
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

const Grid = (props: { children: JSX.Element[] }) => {
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
	const [activeSearchPage, setSearchPage] = useLocalStorage({
		key: "savedSearchPage",
	});
	const [query, setQuery] = useLocalStorage({
		key: "savedQuery",
		getInitialValueInEffect: false,
	});
	const [activeMinePage, setMinePage] = useLocalStorage({
		key: "savedMinePage",
		getInitialValueInEffect: false,
	});
	const router = useRouter();
	const lot = getLot(router.query.lot);
	const offset = (parseInt(activeSearchPage || "1") - 1) * LIMIT;
	const listMedia = useQuery({
		queryKey: ["listMedia", activeMinePage, lot],
		queryFn: async () => {
			if (!lot) throw Error();
			const { mediaList } = await gqlClient.request(MEDIA_LIST, {
				input: { lot, page: parseInt(activeMinePage) || 1 },
			});
			return mediaList;
		},
		onSuccess: () => {
			if (!activeMinePage) setMinePage("1");
		},
		enabled: lot !== undefined,
		staleTime: Infinity,
	});
	const searchQuery = useQuery({
		queryKey: ["searchQuery", activeSearchPage, lot, query],
		queryFn: async () => {
			return await match(lot)
				.with(MetadataLot.Book, async () => {
					const { booksSearch } = await gqlClient.request(BOOKS_SEARCH, {
						input: { query, offset },
					});
					return booksSearch;
				})
				.with(MetadataLot.Movie, async () => {
					const { moviesSearch } = await gqlClient.request(MOVIES_SEARCH, {
						input: { query, page: parseInt(activeSearchPage) || 1 },
					});
					return moviesSearch;
				})
				.otherwise(async () => {
					throw new Error("Unreachable!");
				});
		},
		onSuccess: () => {
			if (!activeSearchPage) setSearchPage("1");
		},
		enabled: query !== "" && lot !== undefined,
		staleTime: Infinity,
	});

	return lot ? (
		<Container>
			<Tabs variant="outline" defaultValue="mine">
				<Tabs.List>
					<Tabs.Tab value="search" icon={<IconSearch size="1.5rem" />}>
						<Text size={"lg"}>Search</Text>
					</Tabs.Tab>
					<Tabs.Tab value="mine" icon={<IconListCheck size="1.5rem" />}>
						<Text size={"lg"}>My {lot.toLowerCase()}s</Text>
					</Tabs.Tab>
					<Box style={{ flexGrow: 1 }}>
						<ActionIcon
							size="lg"
							variant="transparent"
							ml="auto"
							mt="xs"
							loading={searchQuery.isFetching || listMedia.isFetching}
							onClick={() => {
								searchQuery.refetch();
								listMedia.refetch();
							}}
						>
							<IconRefresh size="1.625rem" />
						</ActionIcon>
					</Box>
				</Tabs.List>

				<Tabs.Panel value="search" pt="xs">
					<Stack>
						<TextInput
							name="query"
							placeholder={`Search for a ${lot.toLowerCase()}`}
							icon={<IconSearch />}
							defaultValue={query}
							style={{ flexGrow: 1 }}
							onChange={(e) => setQuery(e.currentTarget.value)}
						/>
						{searchQuery.data && searchQuery.data.total > 0 ? (
							<Grid>
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
							</Grid>
						) : (
							<Text>No media found :(</Text>
						)}
						{searchQuery.data && (
							<Center>
								<Pagination
									size="sm"
									value={parseInt(activeSearchPage)}
									onChange={(v) => setSearchPage(v.toString())}
									total={Math.ceil(searchQuery.data.total / LIMIT)}
									boundaries={1}
									siblings={0}
								/>
							</Center>
						)}
					</Stack>
				</Tabs.Panel>
				<Tabs.Panel value="mine" pt="xs">
					<Stack>
						{listMedia.data && listMedia.data.total > 0 ? (
							<Grid>
								{listMedia.data.items.map((lm, idx) => (
									<MediaItemWithoutUpdateModal
										key={idx}
										item={lm}
										lot={lot}
										imageOnClick={async () => parseInt(lm.identifier)}
									/>
								))}
							</Grid>
						) : (
							<Text>You do not have any saved yet</Text>
						)}
						{listMedia.data && (
							<Center>
								<Pagination
									size="sm"
									value={parseInt(activeMinePage)}
									onChange={(v) => setMinePage(v.toString())}
									total={Math.ceil(listMedia.data.total / LIMIT)}
									boundaries={1}
									siblings={0}
								/>
							</Center>
						)}
					</Stack>
				</Tabs.Panel>
			</Tabs>
		</Container>
	) : null;
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
