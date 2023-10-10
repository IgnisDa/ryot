import Grid from "@/lib/components/Grid";
import {
	MediaItemWithoutUpdateModal,
	MediaSearchItem,
} from "@/lib/components/MediaComponents";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getLot } from "@/lib/utilities";
import {
	ActionIcon,
	Box,
	Center,
	Container,
	Flex,
	Group,
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
	CollectionsDocument,
	GraphqlSortOrder,
	MediaGeneralFilter,
	MediaListDocument,
	MediaSearchDocument,
	MediaSortBy,
	MediaSourcesForLotDocument,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, startCase } from "@ryot/ts-utils";
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
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";
import invariant from "tiny-invariant";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../_app";

const defaultFilters = {
	mineCollectionFilter: undefined,
	mineGeneralFilter: MediaGeneralFilter.All,
	mineSortOrder: GraphqlSortOrder.Desc,
	mineSortBy: MediaSortBy.LastSeen,
};

const Page: NextPageWithLayout = () => {
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [mineSortOrder, setMineSortOrder] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedMineMediaSortOrder,
		defaultValue: defaultFilters.mineSortOrder,
		getInitialValueInEffect: false,
	});
	const [mineSortBy, setMineSortBy] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedMineMediaSortBy,
		defaultValue: defaultFilters.mineSortBy,
		getInitialValueInEffect: false,
	});
	const [mineGeneralFilter, setMineGeneralFilter] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedMineMediaGeneralFilter,
		defaultValue: defaultFilters.mineGeneralFilter,
		getInitialValueInEffect: false,
	});
	const [mineCollectionFilter, setMineCollectionFilter] = useLocalStorage<
		string | undefined
	>({
		key: LOCAL_STORAGE_KEYS.savedMineMediaCollectionFilter,
		defaultValue: defaultFilters.mineCollectionFilter,
		getInitialValueInEffect: false,
		deserialize: (value) => {
			if (value === "__undefined") return undefined;
			return value;
		},
		serialize: (value) => {
			if (typeof value === "undefined") return "__undefined";
			return value;
		},
	});
	const [activeSearchPage, setSearchPage] = useLocalStorage({
		defaultValue: "1",
		key: LOCAL_STORAGE_KEYS.savedMediaSearchPage,
	});
	const [query, setQuery] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedMediaQuery,
		getInitialValueInEffect: false,
	});
	const [searchSource, setSearchSource] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedMediaSearchSource,
	});
	const [activeMinePage, setMinePage] = useLocalStorage({
		defaultValue: "1",
		key: LOCAL_STORAGE_KEYS.savedMediaMinePage,
		getInitialValueInEffect: false,
	});
	const [activeTab, setActiveTab] = useLocalStorage<"mine" | "search">({
		key: LOCAL_STORAGE_KEYS.savedMediaActiveTab,
		getInitialValueInEffect: false,
		defaultValue: "mine",
	});
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(query, 1000);

	const router = useRouter();
	const lot = getLot(router.query.lot);
	const coreDetails = useCoreDetails();

	const listMedia = useQuery({
		queryKey: [
			"listMedia",
			activeMinePage,
			lot,
			mineSortBy,
			mineSortOrder,
			mineGeneralFilter,
			mineCollectionFilter,
			debouncedQuery,
		],
		queryFn: async () => {
			invariant(lot, "Lot is not defined");
			const { mediaList } = await gqlClient.request(MediaListDocument, {
				input: {
					lot,
					search: {
						page: parseInt(activeMinePage || "1"),
						query: debouncedQuery || undefined,
					},
					sort: { order: mineSortOrder, by: mineSortBy },
					filter: {
						general: mineGeneralFilter,
						collection: Number(mineCollectionFilter),
					},
				},
			});
			return mediaList;
		},
		enabled: lot !== undefined && activeTab === "mine",
		retry: false,
	});
	const collections = useQuery({
		queryKey: ["collections"],
		queryFn: async () => {
			const { collections } = await gqlClient.request(CollectionsDocument, {});
			return collections;
		},
		staleTime: Infinity,
	});
	const mediaSources = useQuery({
		queryKey: ["sources", lot],
		queryFn: async () => {
			invariant(lot, "Lot is not defined");
			const { mediaSourcesForLot } = await gqlClient.request(
				MediaSourcesForLotDocument,
				{ lot },
			);
			return mediaSourcesForLot;
		},
		onSuccess: (data) => {
			if (!data.includes(searchSource as unknown as MetadataSource))
				setSearchSource(data[0]);
		},
		staleTime: Infinity,
	});
	const searchQuery = useQuery({
		queryKey: [
			"searchQuery",
			activeSearchPage,
			lot,
			debouncedQuery,
			searchSource,
		],
		queryFn: async () => {
			invariant(searchSource, "Source must be defined");
			invariant(lot, "Lot must be defined");
			const { mediaSearch } = await gqlClient.request(MediaSearchDocument, {
				input: {
					query: debouncedQuery,
					page: parseInt(activeSearchPage || "1"),
				},
				lot,
				source: searchSource as MetadataSource,
			});
			return mediaSearch;
		},
		enabled: query !== "" && lot !== undefined && activeTab === "search",
		staleTime: Infinity,
		retry: false,
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim());
	}, [query]);

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size="1rem" />
			</ActionIcon>
		) : undefined;

	const isFilterChanged =
		mineGeneralFilter !== defaultFilters.mineGeneralFilter ||
		mineSortOrder !== defaultFilters.mineSortOrder ||
		mineSortBy !== defaultFilters.mineSortBy ||
		mineCollectionFilter !== defaultFilters.mineCollectionFilter;

	const resetFilters = () => {
		setMineCollectionFilter(defaultFilters.mineCollectionFilter);
		setMineGeneralFilter(defaultFilters.mineGeneralFilter);
		setMineSortOrder(defaultFilters.mineSortOrder);
		setMineSortBy(defaultFilters.mineSortBy);
	};

	const SearchInput = (props: { placeholder: string }) => {
		return (
			<TextInput
				name="query"
				placeholder={props.placeholder}
				leftSection={<IconSearch />}
				onChange={(e) => setQuery(e.currentTarget.value)}
				value={query}
				rightSection={<ClearButton />}
				style={{ flexGrow: 1 }}
				autoCapitalize="none"
				autoComplete="off"
			/>
		);
	};

	return lot && collections.data && coreDetails.data ? (
		<>
			<Head>
				<title>List {changeCase(lot).toLowerCase()}s | Ryot</title>
			</Head>
			<Container>
				<Tabs
					variant="default"
					value={activeTab}
					onChange={(v) => {
						if (v === "mine" || v === "search") setActiveTab(v);
					}}
				>
					<Tabs.List mb="xs">
						<Tabs.Tab
							value="mine"
							leftSection={<IconListCheck size="1.5rem" />}
						>
							<Text>My {changeCase(lot.toLowerCase())}s</Text>
						</Tabs.Tab>
						<Tabs.Tab value="search" leftSection={<IconSearch size="1.5rem" />}>
							<Text>Search</Text>
						</Tabs.Tab>
						<Flex style={{ flexGrow: 1 }} justify="end">
							<ActionIcon
								size="lg"
								mt={4}
								loading={searchQuery.isFetching}
								onClick={() => {
									searchQuery.refetch();
									listMedia.refetch();
								}}
							>
								<IconRefresh size="1.625rem" />
							</ActionIcon>
						</Flex>
					</Tabs.List>

					<Tabs.Panel value="mine">
						<Stack>
							<Group wrap="nowrap">
								{/* Weird syntax because of: https://stackoverflow.com/a/65328486/11667450 */}
								{SearchInput({
									placeholder: `Sift through your ${changeCase(
										lot.toLowerCase(),
									).toLowerCase()}s`,
								})}
								<ActionIcon
									onClick={openFiltersModal}
									color={isFilterChanged ? "blue" : "gray"}
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
											value={mineGeneralFilter?.toString()}
											data={[
												{
													group: "General filters",
													items: Object.values(MediaGeneralFilter).map((o) => ({
														value: o.toString(),
														label: startCase(o.toLowerCase()),
													})),
												},
											]}
											onChange={(v) => {
												if (v) setMineGeneralFilter(v as MediaGeneralFilter);
											}}
										/>
										<Flex gap="xs" align="center">
											<Select
												w="100%"
												data={[
													{
														group: "Sort by",
														items: Object.values(MediaSortBy).map((o) => ({
															value: o.toString(),
															label: startCase(o.toLowerCase()),
														})),
													},
												]}
												value={mineSortBy?.toString()}
												onChange={(v) => {
													if (v) setMineSortBy(v as MediaSortBy);
												}}
											/>
											<ActionIcon
												onClick={() => {
													if (mineSortOrder === GraphqlSortOrder.Asc)
														setMineSortOrder(GraphqlSortOrder.Desc);
													else setMineSortOrder(GraphqlSortOrder.Asc);
												}}
											>
												{mineSortOrder === GraphqlSortOrder.Asc ? (
													<IconSortAscending />
												) : (
													<IconSortDescending />
												)}
											</ActionIcon>
										</Flex>
										{collections.data && collections.data.length > 0 ? (
											<Select
												placeholder="Select a collection"
												value={mineCollectionFilter}
												data={[
													{
														group: "My collections",
														items: collections.data.map((c) => ({
															value: c?.id?.toString(),
															label: c?.name,
														})),
													},
												]}
												onChange={(v) => {
													setMineCollectionFilter(v || "non");
												}}
												clearable
											/>
										) : undefined}
									</Stack>
								</Modal>
							</Group>
							{listMedia.data && listMedia.data.details.total > 0 ? (
								<>
									<Box>
										<Text display="inline" fw="bold">
											{listMedia.data.details.total}
										</Text>{" "}
										items found
									</Box>
									<Grid>
										{listMedia.data.items.map((lm) => (
											<MediaItemWithoutUpdateModal
												key={lm.data.identifier}
												item={{
													...lm.data,
													publishYear: lm.data.publishYear?.toString(),
												}}
												averageRating={lm.averageRating}
												lot={lot}
												href={withQuery(
													APP_ROUTES.media.individualMediaItem.details,
													{ id: lm.data.identifier },
												)}
											/>
										))}
									</Grid>
								</>
							) : (
								<Text>You do not have any saved yet</Text>
							)}
							{listMedia.data ? (
								<Center>
									<Pagination
										size="sm"
										value={parseInt(activeMinePage || "1")}
										onChange={(v) => setMinePage(v.toString())}
										total={Math.ceil(
											listMedia.data.details.total / coreDetails.data.pageLimit,
										)}
										boundaries={1}
										siblings={0}
									/>
								</Center>
							) : undefined}
						</Stack>
					</Tabs.Panel>

					<Tabs.Panel value="search">
						<Stack>
							<Flex gap="xs">
								{SearchInput({
									placeholder: `Search for ${changeCase(
										lot.toLowerCase(),
									).toLowerCase()}s`,
								})}
								{typeof mediaSources.data?.length !== "undefined" &&
								mediaSources.data.length > 1 ? (
									<Select
										w="37%"
										value={searchSource?.toString()}
										data={mediaSources.data.map((o) => ({
											value: o.toString(),
											label: startCase(o.toLowerCase()),
										}))}
										onChange={(v) => {
											if (v) setSearchSource(v);
										}}
									/>
								) : undefined}
							</Flex>
							{searchQuery.data && searchQuery.data.details.total > 0 ? (
								<>
									<Box>
										<Text display="inline" fw="bold">
											{searchQuery.data.details.total}
										</Text>{" "}
										items found
									</Box>
									<Grid>
										{searchQuery.data.items.map((b, idx) => (
											<MediaSearchItem
												idx={idx}
												key={b.item.identifier}
												item={{
													...b.item,
													publishYear: b.item.publishYear?.toString(),
												}}
												maybeItemId={b.databaseId ?? undefined}
												query={query || ""}
												lot={lot}
												searchQueryRefetch={searchQuery.refetch}
												source={searchSource as unknown as MetadataSource}
											/>
										))}
									</Grid>
								</>
							) : (
								<Text>No media found matching your query</Text>
							)}
							{searchQuery.data ? (
								<Center>
									<Pagination
										size="sm"
										value={parseInt(activeSearchPage || "1")}
										onChange={(v) => setSearchPage(v.toString())}
										total={Math.ceil(
											searchQuery.data.details.total /
												coreDetails.data.pageLimit,
										)}
										boundaries={1}
										siblings={0}
									/>
								</Center>
							) : undefined}
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
