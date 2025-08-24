import {
	ActionIcon,
	Box,
	Container,
	Divider,
	Flex,
	Group,
	Select,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	EntityLot,
	GraphqlSortOrder,
	type MediaCollectionFilter,
	MediaSource,
	MetadataGroupSearchDocument,
	type MetadataGroupSearchInput,
	PersonAndMetadataGroupsSortBy,
	UserMetadataGroupsListDocument,
	type UserMetadataGroupsListInput,
} from "@ryot/generated/graphql/backend/graphql";
import { cloneDeep, startCase } from "@ryot/ts-utils";
import {
	IconCheck,
	IconFilter,
	IconListCheck,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import { useLocalStorage } from "usehooks-ts";
import {
	ApplicationPagination,
	BulkCollectionEditingAffix,
	DisplayListDetailsAndRefresh,
	SkeletonLoader,
} from "~/components/common";
import {
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataGroupDisplayItem } from "~/components/media/display-items";
import { useCoreDetails, useUserPreferences } from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	isFilterChanged,
} from "~/lib/shared/ui-utils";
import { useBulkEditCollection } from "~/lib/state/collection";
import type { FilterUpdateFunction } from "~/lib/types";

export type SearchParams = {
	query?: string;
};

interface ListFilterState {
	query?: string;
	orderBy: GraphqlSortOrder;
	collections: MediaCollectionFilter[];
	sortBy: PersonAndMetadataGroupsSortBy;
}

interface SearchFilterState {
	query?: string;
	source: MediaSource;
}

const defaultListFilters: ListFilterState = {
	collections: [],
	orderBy: GraphqlSortOrder.Desc,
	sortBy: PersonAndMetadataGroupsSortBy.AssociatedEntityCount,
};

const defaultSearchFilters: SearchFilterState = {
	source: MediaSource.Tmdb,
};

export const meta = () => {
	return [{ title: "Media Groups | Ryot" }];
};

export default function Page(props: { params: { action: string } }) {
	const navigate = useNavigate();
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const action = props.params.action;

	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	const [listFilters, setListFilters] = useLocalStorage<ListFilterState>(
		"GroupsListFilters",
		defaultListFilters,
	);
	const [searchFilters, setSearchFilters] = useLocalStorage<SearchFilterState>(
		"GroupsSearchFilters",
		defaultSearchFilters,
	);
	const [searchQuery, setSearchQuery] = useLocalStorage(
		"GroupsSearchQuery",
		"",
	);
	const [currentPage, setCurrentPage] = useLocalStorage("GroupsCurrentPage", 1);

	const listInput: UserMetadataGroupsListInput = useMemo(
		() => ({
			filter: { collections: listFilters.collections },
			sort: { by: listFilters.sortBy, order: listFilters.orderBy },
			search: { page: currentPage, query: listFilters.query || searchQuery },
		}),
		[listFilters, searchQuery, currentPage],
	);

	const {
		data: userMetadataGroupsList,
		refetch: refetchUserMetadataGroupsList,
	} = useQuery({
		enabled: action === "list",
		queryKey: queryFactory.media.userMetadataGroupsList(listInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(UserMetadataGroupsListDocument, { input: listInput })
				.then((data) => data.userMetadataGroupsList),
	});

	const searchInput: MetadataGroupSearchInput = useMemo(() => {
		const lot = coreDetails.metadataGroupSourceLotMappings.find(
			(m) => m.source === searchFilters.source,
		)?.lot;
		if (!lot) throw new Error("Invalid source selected");
		return {
			lot,
			source: searchFilters.source,
			search: { page: currentPage, query: searchQuery },
		};
	}, [searchFilters.source, searchQuery, currentPage, coreDetails]);

	const { data: metadataGroupSearch } = useQuery({
		enabled: action === "search" && !!searchInput.lot,
		queryKey: queryFactory.media.metadataGroupSearch(searchInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(MetadataGroupSearchDocument, { input: searchInput })
				.then((data) => data.metadataGroupSearch),
	});

	const areListFiltersActive = isFilterChanged(listFilters, defaultListFilters);

	const updateListFilters: FilterUpdateFunction<ListFilterState> = (
		key,
		value,
	) => setListFilters((prev) => ({ ...prev, [key]: value }));

	const updateSearchFilters: FilterUpdateFunction<SearchFilterState> = (
		key,
		value,
	) => setSearchFilters((prev) => ({ ...prev, [key]: value }));

	return (
		<>
			<BulkCollectionEditingAffix
				bulkAddEntities={async () => {
					if (action !== "list") return [];
					const input = cloneDeep(listInput);
					input.search = { ...input.search, take: Number.MAX_SAFE_INTEGER };
					return await clientGqlService
						.request(UserMetadataGroupsListDocument, { input })
						.then((r) =>
							r.userMetadataGroupsList.response.items.map((m) => ({
								entityId: m,
								entityLot: EntityLot.MetadataGroup,
							})),
						);
				}}
			/>
			<Container>
				<Stack>
					<Title>Groups</Title>
					<Tabs
						variant="default"
						value={action}
						onChange={(v) => {
							if (v)
								navigate(
									$path(
										"/media/groups/:action",
										{ action: v },
										{ query: searchQuery },
									),
								);
						}}
					>
						<Tabs.List style={{ alignItems: "center" }}>
							<Tabs.Tab value="list" leftSection={<IconListCheck size={24} />}>
								<Text>My Groups</Text>
							</Tabs.Tab>
							<Tabs.Tab value="search" leftSection={<IconSearch size={24} />}>
								<Text>Search</Text>
							</Tabs.Tab>
						</Tabs.List>
					</Tabs>
					<Group wrap="nowrap">
						<DebouncedSearchInput
							placeholder="Search for groups"
							initialValue={searchQuery}
							onChange={(value) => {
								setSearchQuery(value);
								setCurrentPage(1);
								if (action === "list") {
									updateListFilters("query", value);
								}
							}}
						/>
						{action === "list" ? (
							<>
								<ActionIcon
									onClick={openFiltersModal}
									color={areListFiltersActive ? "blue" : "gray"}
								>
									<IconFilter size={24} />
								</ActionIcon>
								<FiltersModal
									opened={filtersModalOpened}
									closeFiltersModal={closeFiltersModal}
									resetFilters={() => setListFilters(defaultListFilters)}
								>
									<FiltersModalForm
										filters={listFilters}
										onFiltersChange={updateListFilters}
									/>
								</FiltersModal>
							</>
						) : null}
						{action === "search" ? (
							<Select
								value={searchFilters.source}
								onChange={(v) =>
									v && updateSearchFilters("source", v as MediaSource)
								}
								data={coreDetails.metadataGroupSourceLotMappings.map((o) => ({
									value: o.source.toString(),
									label: startCase(o.source.toLowerCase()),
								}))}
							/>
						) : null}
					</Group>

					{action === "list" ? (
						userMetadataGroupsList ? (
							<>
								<DisplayListDetailsAndRefresh
									cacheId={userMetadataGroupsList.cacheId}
									total={userMetadataGroupsList.response.details.total}
									onRefreshButtonClicked={refetchUserMetadataGroupsList}
									isRandomSortOrderSelected={
										listFilters.sortBy === PersonAndMetadataGroupsSortBy.Random
									}
								/>
								{userMetadataGroupsList.response.details.total > 0 ? (
									<ApplicationGrid>
										{userMetadataGroupsList.response.items.map((gr) => (
											<MetadataGroupListItem key={gr} item={gr} />
										))}
									</ApplicationGrid>
								) : (
									<Text>No information to display</Text>
								)}
								<ApplicationPagination
									value={currentPage}
									onChange={setCurrentPage}
									total={Math.ceil(
										userMetadataGroupsList.response.details.total /
											userPreferences.general.listPageSize,
									)}
								/>
							</>
						) : (
							<SkeletonLoader />
						)
					) : null}

					{action === "search" ? (
						metadataGroupSearch ? (
							<>
								<Box>
									<Text display="inline" fw="bold">
										{metadataGroupSearch.response.details.total}
									</Text>{" "}
									items found
								</Box>
								{metadataGroupSearch.response.details.total > 0 ? (
									<ApplicationGrid>
										{metadataGroupSearch.response.items.map((group) => (
											<MetadataGroupDisplayItem
												key={group}
												metadataGroupId={group}
												shouldHighlightNameIfInteracted
											/>
										))}
									</ApplicationGrid>
								) : (
									<Text>No groups found matching your query</Text>
								)}
								<ApplicationPagination
									total={Math.ceil(
										metadataGroupSearch.response.details.total / 20,
									)}
									value={currentPage}
									onChange={setCurrentPage}
								/>
							</>
						) : (
							<SkeletonLoader />
						)
					) : null}
				</Stack>
			</Container>
		</>
	);
}

interface FiltersModalFormProps {
	filters: ListFilterState;
	onFiltersChange: FilterUpdateFunction<ListFilterState>;
}

const FiltersModalForm = (props: FiltersModalFormProps) => {
	const { filters, onFiltersChange } = props;

	return (
		<>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					value={filters.sortBy}
					data={convertEnumToSelectData(PersonAndMetadataGroupsSortBy)}
					onChange={(v) =>
						v && onFiltersChange("sortBy", v as PersonAndMetadataGroupsSortBy)
					}
				/>
				<ActionIcon
					onClick={() => {
						if (filters.orderBy === GraphqlSortOrder.Asc)
							onFiltersChange("orderBy", GraphqlSortOrder.Desc);
						else onFiltersChange("orderBy", GraphqlSortOrder.Asc);
					}}
				>
					{filters.orderBy === GraphqlSortOrder.Asc ? (
						<IconSortAscending />
					) : (
						<IconSortDescending />
					)}
				</ActionIcon>
			</Flex>
			<Divider />
			<CollectionsFilter
				applied={filters.collections}
				cookieName="GroupsListFilters"
				onFiltersChanged={(val) => onFiltersChange("collections", val)}
			/>
		</>
	);
};

type MetadataGroupListItemProps = {
	item: string;
};

const MetadataGroupListItem = (props: MetadataGroupListItemProps) => {
	const bulkEditingCollection = useBulkEditCollection();
	const bulkEditingState = bulkEditingCollection.state;

	const becItem = { entityId: props.item, entityLot: EntityLot.MetadataGroup };
	const isAlreadyPresent = bulkEditingCollection.isAlreadyPresent(becItem);
	const isAdded = bulkEditingCollection.isAdded(becItem);

	return (
		<MetadataGroupDisplayItem
			metadataGroupId={props.item}
			topRight={
				bulkEditingState &&
				bulkEditingState.data.action === "add" &&
				!isAlreadyPresent ? (
					<ActionIcon
						variant={isAdded ? "filled" : "transparent"}
						color="green"
						onClick={() => {
							if (isAdded) bulkEditingState.remove(becItem);
							else bulkEditingState.add(becItem);
						}}
					>
						<IconCheck size={18} />
					</ActionIcon>
				) : undefined
			}
		/>
	);
};
