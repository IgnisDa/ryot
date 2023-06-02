import type { NextPageWithLayout } from "./_app";
import Grid from "@/lib/components/Grid";
import MediaItem, {
	MediaItemWithoutUpdateModal,
} from "@/lib/components/MediaItem";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { changeCase, getLot } from "@/lib/utilities";
import {
	ActionIcon,
	Box,
	Center,
	Container,
	Flex,
	Group,
	Grid as MantineGrid,
	Modal,
	Pagination,
	Select,
	Stack,
	Tabs,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import {
	useDebouncedState,
	useDisclosure,
	useLocalStorage,
} from "@mantine/hooks";
import {
	AudioBooksSearchDocument,
	BooksSearchDocument,
	MediaFilter,
	MediaListDocument,
	MediaSortBy,
	MediaSortOrder,
	MetadataLot,
	MoviesSearchDocument,
	PodcastsSearchDocument,
	ShowsSearchDocument,
	VideoGamesSearchDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconFilter,
	IconFilterOff,
	IconListCheck,
	IconRefresh,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { lowerCase, startCase } from "lodash";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";

const LIMIT = 20;

const defaultFilters = {
	mineFilter: MediaFilter.All,
	mineSortOrder: MediaSortOrder.Asc,
	mineSortBy: MediaSortBy.ReleaseDate,
};

const Page: NextPageWithLayout = () => {
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [mineSortOrder, setMineSortOrder] = useLocalStorage({
		key: "mineSortOrder",
		defaultValue: defaultFilters.mineSortOrder,
		getInitialValueInEffect: false,
	});
	const [mineSortBy, setMineSortBy] = useLocalStorage({
		key: "mineSortBy",
		defaultValue: defaultFilters.mineSortBy,
		getInitialValueInEffect: false,
	});
	const [mineFilter, setMineFilter] = useLocalStorage({
		key: "mineFilter",
		defaultValue: defaultFilters.mineFilter,
		getInitialValueInEffect: false,
	});
	const [activeSearchPage, setSearchPage] = useLocalStorage({
		key: "savedSearchPage",
	});
	const [query, setQuery] = useLocalStorage({
		key: "savedQuery",
		getInitialValueInEffect: false,
	});
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(query, 1000);
	const [activeMinePage, setMinePage] = useLocalStorage({
		key: "savedMinePage",
		getInitialValueInEffect: false,
	});
	const router = useRouter();
	const lot = getLot(router.query.lot);
	const offset = (parseInt(activeSearchPage || "1") - 1) * LIMIT;
	const listMedia = useQuery({
		queryKey: [
			"listMedia",
			activeMinePage,
			lot,
			mineSortBy,
			mineSortOrder,
			mineFilter,
			debouncedQuery,
		],
		queryFn: async () => {
			invariant(lot, "Lot is not defined");
			const { mediaList } = await gqlClient.request(MediaListDocument, {
				input: {
					lot,
					page: parseInt(activeMinePage) || 1,
					sort: { order: mineSortOrder, by: mineSortBy },
					query: debouncedQuery || undefined,
					filter: mineFilter,
				},
			});
			return mediaList;
		},
		onSuccess: () => {
			if (!activeMinePage) setMinePage("1");
		},
		enabled: lot !== undefined,
	});
	const [activeTab, setActiveTab] = useState<string | null>(
		listMedia.data?.total === 0 ? "search" : "mine",
	);
	const searchQuery = useQuery({
		queryKey: ["searchQuery", activeSearchPage, lot, debouncedQuery],
		queryFn: async () => {
			invariant(lot, "Lot must be defined");
			return await match(lot)
				.with(MetadataLot.Book, async () => {
					const { booksSearch } = await gqlClient.request(BooksSearchDocument, {
						input: {
							query: debouncedQuery,
							page: parseInt(activeSearchPage) || 1,
						},
					});
					return booksSearch;
				})
				.with(MetadataLot.Movie, async () => {
					const { moviesSearch } = await gqlClient.request(
						MoviesSearchDocument,
						{
							input: { query, page: parseInt(activeSearchPage) || 1 },
						},
					);
					return moviesSearch;
				})
				.with(MetadataLot.Show, async () => {
					const { showSearch } = await gqlClient.request(ShowsSearchDocument, {
						input: { query, page: parseInt(activeSearchPage) || 1 },
					});
					return showSearch;
				})
				.with(MetadataLot.VideoGame, async () => {
					const { videoGamesSearch } = await gqlClient.request(
						VideoGamesSearchDocument,
						{
							input: { query, page: parseInt(activeSearchPage) || 1 },
						},
					);
					return videoGamesSearch;
				})
				.with(MetadataLot.AudioBook, async () => {
					const { audioBooksSearch } = await gqlClient.request(
						AudioBooksSearchDocument,
						{
							input: { query, page: parseInt(activeSearchPage) || 1 },
						},
					);
					return audioBooksSearch;
				})
				.with(MetadataLot.Podcast, async () => {
					const { podcastsSearch } = await gqlClient.request(
						PodcastsSearchDocument,
						{
							input: { query, page: parseInt(activeSearchPage) || 1 },
						},
					);
					return podcastsSearch;
				})
				.exhaustive();
		},
		onSuccess: () => {
			if (!activeSearchPage) setSearchPage("1");
		},
		enabled: query !== "" && lot !== undefined && activeTab === "search",
		staleTime: Infinity,
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim());
	}, [query]);

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size="1rem" />
			</ActionIcon>
		) : null;

	const isFilterChanged =
		mineFilter !== defaultFilters.mineFilter ||
		mineSortOrder !== defaultFilters.mineSortOrder ||
		mineSortBy !== defaultFilters.mineSortBy;

	const resetFilters = () => {
		setMineFilter(defaultFilters.mineFilter);
		setMineSortOrder(defaultFilters.mineSortOrder);
		setMineSortBy(defaultFilters.mineSortBy);
	};

	return lot ? (
		<>
			<Head>
				<title>List {changeCase(lot).toLowerCase()}s | Ryot</title>
			</Head>
			<Container>
				<Tabs variant="outline" value={activeTab} onTabChange={setActiveTab}>
					<Tabs.List mb={"xs"}>
						<Tabs.Tab value="mine" icon={<IconListCheck size="1.5rem" />}>
							<Text size={"lg"}>My {changeCase(lot.toLowerCase())}s</Text>
						</Tabs.Tab>
						<Tabs.Tab value="search" icon={<IconSearch size="1.5rem" />}>
							<Text size={"lg"}>Search</Text>
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

					<Tabs.Panel value="mine">
						<Stack>
							<MantineGrid grow>
								<MantineGrid.Col span={12}>
									<Flex align={"center"} gap="xs">
										<TextInput
											name="query"
											placeholder={`Sift through your ${changeCase(
												lot.toLowerCase(),
											).toLowerCase()}s`}
											icon={<IconSearch />}
											onChange={(e) => setQuery(e.currentTarget.value)}
											value={query}
											rightSection={<ClearButton />}
											style={{ flexGrow: 1 }}
										/>
										<ActionIcon
											onClick={openFiltersModal}
											color={isFilterChanged ? "blue" : undefined}
										>
											<IconFilter size="1.5rem" />
										</ActionIcon>
										<Modal
											opened={filtersModalOpened}
											onClose={closeFiltersModal}
											centered
											withCloseButton={false}
										>
											<Stack>
												<Group>
													<Title order={3}>Filters</Title>
													<ActionIcon onClick={resetFilters}>
														<IconFilterOff size="1.5rem" />
													</ActionIcon>
												</Group>
												<Select
													withinPortal
													value={mineFilter.toString()}
													data={Object.values(MediaFilter).map((o) => ({
														value: o.toString(),
														label: startCase(lowerCase(o)),
													}))}
													onChange={(v) => {
														const filter = match(v)
															.with("ALL", () => MediaFilter.All)
															.with("RATED", () => MediaFilter.Rated)
															.with("UNRATED", () => MediaFilter.Unrated)
															.otherwise(() => MediaFilter.All);
														setMineFilter(filter);
													}}
												/>
												<Flex gap={"xs"} align={"center"}>
													<Select
														withinPortal
														w="100%"
														data={Object.values(MediaSortBy).map((o) => ({
															value: o.toString(),
															label: startCase(lowerCase(o)),
														}))}
														value={mineSortBy.toString()}
														onChange={(v) => {
															const orderBy = match(v)
																.with(
																	"RELEASE_DATE",
																	() => MediaSortBy.ReleaseDate,
																)
																.with("RATING", () => MediaSortBy.Rating)
																.with("LAST_SEEN", () => MediaSortBy.LastSeen)
																.with("TITLE", () => MediaSortBy.Title)
																.otherwise(() => MediaSortBy.Title);
															setMineSortBy(orderBy);
														}}
													/>
													<ActionIcon
														onClick={() => {
															if (mineSortOrder === MediaSortOrder.Asc)
																setMineSortOrder(MediaSortOrder.Desc);
															else setMineSortOrder(MediaSortOrder.Asc);
														}}
													>
														{mineSortOrder === MediaSortOrder.Asc ? (
															<IconSortAscending />
														) : (
															<IconSortDescending />
														)}
													</ActionIcon>
												</Flex>
											</Stack>
										</Modal>
									</Flex>
								</MantineGrid.Col>
							</MantineGrid>
							{listMedia.data && listMedia.data.total > 0 ? (
								<>
									<Box>
										<Text display={"inline"} fw="bold">
											{listMedia.data.total}
										</Text>{" "}
										items found
									</Box>
									<Grid>
										{listMedia.data.items.map((lm) => (
											<MediaItemWithoutUpdateModal
												key={lm.identifier}
												item={lm}
												lot={lot}
												imageOnClick={async () => parseInt(lm.identifier)}
											/>
										))}
									</Grid>
								</>
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

					<Tabs.Panel value="search">
						<Stack>
							<TextInput
								name="query"
								placeholder={`Search for a ${changeCase(
									lot.toLowerCase(),
								).toLowerCase()}`}
								icon={<IconSearch />}
								style={{ flexGrow: 1 }}
								onChange={(e) => setQuery(e.currentTarget.value)}
								value={query}
								rightSection={<ClearButton />}
							/>
							{searchQuery.data && searchQuery.data.total > 0 ? (
								<>
									<Box>
										<Text display={"inline"} fw="bold">
											{searchQuery.data.total}
										</Text>{" "}
										items found
									</Box>
									<Grid>
										{searchQuery.data.items.map((b, idx) => (
											<MediaItem
												idx={idx}
												key={b.identifier}
												item={b}
												query={query}
												offset={offset}
												lot={lot}
												refetch={searchQuery.refetch}
											/>
										))}
									</Grid>
								</>
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
				</Tabs>
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
