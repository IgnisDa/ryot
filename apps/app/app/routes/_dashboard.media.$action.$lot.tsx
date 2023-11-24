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
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import { LoaderFunctionArgs, json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
	GraphqlSortOrder,
	MediaGeneralFilter,
	MediaListDocument,
	MediaSearchDocument,
	MediaSortBy,
	MetadataSource,
	UserCollectionsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, startCase } from "@ryot/ts-utils";
import {
	IconFilter,
	IconFilterOff,
	IconListCheck,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
	IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import Grid from "~/components/grid";
import { MediaItemWithoutUpdateModal } from "~/components/media-components";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "~/lib/constants";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import { getLot } from "~/lib/utilities";

const defaultFilters = {
	mineCollectionFilter: undefined,
	mineGeneralFilter: MediaGeneralFilter.All,
	mineSortOrder: GraphqlSortOrder.Desc,
	mineSortBy: MediaSortBy.LastSeen,
};

enum Action {
	Search = "search",
	List = "list",
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const [coreDetails, userPreferences] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
	]);
	const { query } = zx.parseQuery(request, {
		query: z.string().optional(),
	});
	const lot = getLot(params.lot);
	invariant(lot, "Lot is not defined");
	const action = params.action as Action;
	invariant(
		action && Object.values(Action).includes(action as Action),
		"Incorrect action",
	);
	const [mediaList, mediaSearch] = await match(action)
		.with(Action.List, async () => {
			const urlParse = zx.parseQuery(request, {
				page: z.number().default(1),
				sortOrder: z
					.nativeEnum(GraphqlSortOrder)
					.default(defaultFilters.mineSortOrder),
				sortBy: z.nativeEnum(MediaSortBy).default(defaultFilters.mineSortBy),
				generalFilter: z
					.nativeEnum(MediaGeneralFilter)
					.default(defaultFilters.mineGeneralFilter),
				collectionFilter: zx.IntAsString.optional(),
			});
			const { mediaList } = await gqlClient.request(
				MediaListDocument,
				{
					input: {
						lot,
						search: { page: urlParse.page, query },
						sort: { order: urlParse.sortOrder, by: urlParse.sortBy },
						filter: {
							general: urlParse.generalFilter,
							collection: urlParse.collectionFilter,
						},
					},
				},
				await getAuthorizationHeader(request),
			);
			const { userCollectionsList } = await gqlClient.request(
				UserCollectionsListDocument,
				{},
				await getAuthorizationHeader(request),
			);
			return [
				{ list: mediaList, collections: userCollectionsList, url: urlParse },
				undefined,
			] as const;
		})
		.with(Action.Search, async () => {
			const { mediaSearch } = await gqlClient.request(MediaSearchDocument, {
				lot,
				input: {
					search: {
						page: activeSearchPage || 1,
						query: debouncedQuery || undefined,
					},
				},
				source: searchSource as MetadataSource,
			});
			return [undefined, { search: mediaSearch }] as const;
		})
		.exhaustive();
	return json({
		userPreferences,
		lot,
		coreDetails,
		action,
		mediaList,
		mediaSearch,
		query,
	});
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [searchParams, setSearchParams] = useSearchParams();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [activeSearchPage, setSearchPage] = useLocalStorage({
		defaultValue: 1,
		key: LOCAL_STORAGE_KEYS.savedMediaSearchPage,
	});
	const [searchSource, setSearchSource] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedMediaSearchSource,
	});
	const [activeMinePage, setMinePage] = useLocalStorage({
		defaultValue: 1,
		key: LOCAL_STORAGE_KEYS.savedMediaMinePage,
		getInitialValueInEffect: false,
	});
	const [activeTab, setActiveTab] = useLocalStorage<"mine" | "search">({
		key: LOCAL_STORAGE_KEYS.savedMediaActiveTab,
		getInitialValueInEffect: false,
		defaultValue: "mine",
	});
	const [query, setQuery] = useState(searchParams.get("query") || "");

	// const mediaSources = useQuery({
	// 	queryKey: ["sources", loaderData.lot],
	// 	queryFn: async () => {
	// 		invariant(loaderData.lot, "Lot is not defined");
	// 		const { mediaSourcesForLot } = await gqlClient.request(
	// 			MediaSourcesForLotDocument,
	// 			{ lot: loaderData.lot },
	// 		);
	// 		return mediaSourcesForLot;
	// 	},
	// 	staleTime: Infinity,
	// });

	// useEffect(() => {
	// 	if (
	// 		mediaSources.data &&
	// 		!mediaSources.data.includes(searchSource as unknown as MetadataSource)
	// 	)
	// 		setSearchSource(mediaSources.data[0]);
	// }, [mediaSources.data]);

	// const searchQuery = useQuery({
	// 	queryKey: [
	// 		"searchQuery",
	// 		activeSearchPage,
	// 		loaderData.lot,
	// 		debouncedQuery,
	// 		searchSource,
	// 	],
	// 	queryFn: async () => {
	// 		invariant(searchSource, "Source must be defined");
	// 		invariant(loaderData.lot, "Lot must be defined");
	// 		const { mediaSearch } = await gqlClient.request(MediaSearchDocument, {
	// 			input: {
	// 				query: debouncedQuery,
	// 				page: activeSearchPage || 1,
	// 			},
	// 			lot: loaderData.lot,
	// 			source: searchSource as MetadataSource,
	// 		});
	// 		return mediaSearch;
	// 	},
	// 	enabled:
	// 		query !== "" && loaderData.lot !== undefined && activeTab === "search",
	// 	staleTime: Infinity,
	// 	retry: false,
	// });

	useEffect(() => {
		setSearchParams((prev) => {
			if (query) prev.set("query", query);
			else prev.delete("query");
			return prev;
		});
	}, [query]);

	const isFilterChanged =
		loaderData.mediaList?.url.generalFilter !==
			defaultFilters.mineGeneralFilter ||
		loaderData.mediaList?.url.sortOrder !== defaultFilters.mineSortOrder ||
		loaderData.mediaList?.url.sortBy !== defaultFilters.mineSortBy ||
		loaderData.mediaList?.url.collectionFilter !==
			defaultFilters.mineCollectionFilter;

	const ClearButton = () => (
		<ActionIcon onClick={() => setQuery("")} disabled={query === ""}>
			<IconX size={16} />
		</ActionIcon>
	);

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

	return (
		<Container>
			<Tabs
				variant="default"
				value={activeTab}
				onChange={(v) => {
					if (v === "mine" || v === "search") setActiveTab(v);
				}}
			>
				<Tabs.List mb="xs">
					<Tabs.Tab value="mine" leftSection={<IconListCheck size={24} />}>
						<Text>My {changeCase(loaderData.lot.toLowerCase())}s</Text>
					</Tabs.Tab>
					<Tabs.Tab value="search" leftSection={<IconSearch size={24} />}>
						<Text>Search</Text>
					</Tabs.Tab>
				</Tabs.List>

				<Tabs.Panel value="mine">
					{loaderData.mediaList ? (
						<Stack>
							<Group wrap="nowrap">
								{SearchInput({
									placeholder: `Sift through your ${changeCase(
										loaderData.lot.toLowerCase(),
									).toLowerCase()}s`,
								})}
								<ActionIcon
									onClick={openFiltersModal}
									color={isFilterChanged ? "blue" : "gray"}
								>
									<IconFilter size={24} />
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
											<ActionIcon
												onClick={() => {
													setSearchParams((prev) => {
														prev.delete("generalFilter");
														prev.delete("sortBy");
														prev.delete("sortOrder");
														prev.delete("collectionFilter");
														return prev;
													});
													closeFiltersModal();
												}}
											>
												<IconFilterOff size={24} />
											</ActionIcon>
										</Group>
										<Select
											defaultValue={loaderData.mediaList.url.generalFilter}
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
												if (v)
													setSearchParams((prev) => {
														prev.set("generalFilter", v);
														return prev;
													});
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
												defaultValue={loaderData.mediaList.url.sortBy}
												onChange={(v) => {
													if (v)
														setSearchParams((prev) => {
															prev.set("sortBy", v);
															return prev;
														});
												}}
											/>
											<ActionIcon
												onClick={() => {
													if (
														loaderData.mediaList?.url.sortOrder ===
														GraphqlSortOrder.Asc
													)
														setSearchParams((prev) => {
															prev.set("sortOrder", GraphqlSortOrder.Desc);
															return prev;
														});
													else
														setSearchParams((prev) => {
															prev.set("sortOrder", GraphqlSortOrder.Asc);
															return prev;
														});
												}}
											>
												{loaderData.mediaList.url.sortOrder ===
												GraphqlSortOrder.Asc ? (
													<IconSortAscending />
												) : (
													<IconSortDescending />
												)}
											</ActionIcon>
										</Flex>
										{loaderData.mediaList.collections.length > 0 ? (
											<Select
												placeholder="Select a collection"
												defaultValue={loaderData.mediaList.url.collectionFilter?.toString()}
												data={[
													{
														group: "My collections",
														items: loaderData.mediaList.collections.map(
															(c) => ({
																value: c.id.toString(),
																label: c.name,
															}),
														),
													},
												]}
												onChange={(v) => {
													setSearchParams((prev) => {
														if (v) prev.set("collectionFilter", v);
														else prev.delete("collectionFilter");
														return prev;
													});
												}}
												clearable
											/>
										) : undefined}
									</Stack>
								</Modal>
							</Group>
							{loaderData.mediaList.list.details.total > 0 ? (
								<>
									<Box>
										<Text display="inline" fw="bold">
											{loaderData.mediaList.list.details.total}
										</Text>{" "}
										items found
									</Box>
									<Grid>
										{loaderData.mediaList.list.items.map((lm) => (
											<MediaItemWithoutUpdateModal
												key={lm.data.identifier}
												item={{
													...lm.data,
													publishYear: lm.data.publishYear?.toString(),
												}}
												averageRating={lm.averageRating ?? undefined}
												lot={loaderData.lot}
												href={withQuery(
													APP_ROUTES.media.individualMediaItem.details,
													{ id: lm.data.identifier },
												)}
												userPreferences={loaderData.userPreferences}
											/>
										))}
									</Grid>
								</>
							) : (
								<Text>You do not have any saved yet</Text>
							)}
							{loaderData.mediaList.list ? (
								<Center>
									<Pagination
										size="sm"
										value={activeMinePage || 1}
										onChange={(v) => setMinePage(v)}
										total={Math.ceil(
											loaderData.mediaList.list.details.total /
												loaderData.coreDetails.pageLimit,
										)}
										boundaries={1}
										siblings={0}
									/>
								</Center>
							) : undefined}
						</Stack>
					) : undefined}
				</Tabs.Panel>

				{/* <Tabs.Panel value="search">
					<Stack>
						<Flex gap="xs">
							{SearchInput({
								placeholder: `Search for ${changeCase(
									loaderData.lot.toLowerCase(),
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
											lot={loaderData.lot}
											searchQueryRefetch={searchQuery.refetch}
											source={searchSource as unknown as MetadataSource}
											userPreferences={loaderData.userPreferences}
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
									value={activeSearchPage || 1}
									onChange={(v) => setSearchPage(v)}
									total={Math.ceil(
										searchQuery.data.details.total /
											loaderData.coreDetails.pageLimit,
									)}
									boundaries={1}
									siblings={0}
								/>
							</Center>
						) : undefined}
					</Stack>
				</Tabs.Panel> */}
			</Tabs>
		</Container>
	);
}
