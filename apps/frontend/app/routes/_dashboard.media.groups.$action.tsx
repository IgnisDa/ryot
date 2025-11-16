import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Box,
	Button,
	Chip,
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
	FilterPresetContextType,
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
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import { useLocalStorage } from "usehooks-ts";
import {
	ApplicationPagination,
	CreateButton,
	DisplayListDetailsAndRefresh,
	SkeletonLoader,
} from "~/components/common";
import { BulkCollectionEditingAffix } from "~/components/common/BulkCollectionEditingAffix";
import {
	CreateFilterPresetModal,
	FilterPresetChip,
} from "~/components/common/filter-presets";
import {
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
	SortOrderToggle,
} from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataGroupDisplayItem } from "~/components/media/display-items";
import { useFilterPresets } from "~/lib/hooks/use-filter-presets";
import { useCoreDetails, useUserMetadataGroupList } from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	isFilterChanged,
} from "~/lib/shared/ui-utils";
import { useBulkEditCollection } from "~/lib/state/collection";
import type { FilterUpdateFunction } from "~/lib/types";

interface ListFilterState {
	page: number;
	query: string;
	orderBy: GraphqlSortOrder;
	collections: MediaCollectionFilter[];
	sortBy: PersonAndMetadataGroupsSortBy;
}

interface SearchFilterState {
	page: number;
	query: string;
	source: MediaSource;
}

const defaultListFilters: ListFilterState = {
	page: 1,
	query: "",
	collections: [],
	orderBy: GraphqlSortOrder.Desc,
	sortBy: PersonAndMetadataGroupsSortBy.AssociatedEntityCount,
};

const defaultSearchFilters: SearchFilterState = {
	page: 1,
	query: "",
	source: MediaSource.Tmdb,
};

export const meta = () => {
	return [{ title: "Media Groups | Ryot" }];
};

export default function Page(props: { params: { action: string } }) {
	const navigate = useNavigate();
	const action = props.params.action;
	const coreDetails = useCoreDetails();
	const [listPresetParent] = useAutoAnimate();
	const [searchPresetParent] = useAutoAnimate();

	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [
		searchFiltersModalOpened,
		{ open: openSearchFiltersModal, close: closeSearchFiltersModal },
	] = useDisclosure(false);
	const [
		listPresetModalOpened,
		{ open: openListPresetModal, close: closeListPresetModal },
	] = useDisclosure(false);
	const [
		searchPresetModalOpened,
		{ open: openSearchPresetModal, close: closeSearchPresetModal },
	] = useDisclosure(false);

	const [listFilters, setListFilters] = useLocalStorage<ListFilterState>(
		"GroupsListFilters",
		defaultListFilters,
	);
	const [searchFilters, setSearchFilters] = useLocalStorage<SearchFilterState>(
		"GroupsSearchFilters",
		defaultSearchFilters,
	);
	const normalizedListFilters = useMemo(
		() => ({ ...defaultListFilters, ...listFilters }),
		[listFilters],
	);
	const normalizedSearchFilters = useMemo(
		() => ({ ...defaultSearchFilters, ...searchFilters }),
		[searchFilters],
	);

	const metadataGroupSourceOptions = useMemo(
		() =>
			coreDetails.metadataGroupSourceLotMappings.map((o) => ({
				value: o.source.toString(),
				label: startCase(o.source.toLowerCase()),
			})),
		[coreDetails.metadataGroupSourceLotMappings],
	);

	const setListFiltersState = (filters: ListFilterState) =>
		setListFilters({ ...defaultListFilters, ...filters });

	const setSearchFiltersState = (filters: SearchFilterState) =>
		setSearchFilters({ ...defaultSearchFilters, ...filters });

	const listPresets = useFilterPresets({
		contextInformation: {},
		enabled: action === "list",
		filters: normalizedListFilters,
		setFilters: setListFiltersState,
		storageKeyPrefix: "GroupsListActivePreset",
		contextType: FilterPresetContextType.MetadataGroupsList,
	});

	const searchPresets = useFilterPresets({
		contextInformation: {},
		enabled: action === "search",
		filters: normalizedSearchFilters,
		setFilters: setSearchFiltersState,
		storageKeyPrefix: "GroupsSearchActivePreset",
		contextType: FilterPresetContextType.MetadataGroupsSearch,
	});

	const handleSaveListPreset = async (name: string) => {
		await listPresets.savePreset(name);
		closeListPresetModal();
	};

	const handleSaveSearchPreset = async (name: string) => {
		await searchPresets.savePreset(name);
		closeSearchPresetModal();
	};

	const listInput: UserMetadataGroupsListInput = useMemo(
		() => ({
			filter: { collections: normalizedListFilters.collections },
			search: {
				page: normalizedListFilters.page,
				query: normalizedListFilters.query,
			},
			sort: {
				by: normalizedListFilters.sortBy,
				order: normalizedListFilters.orderBy,
			},
		}),
		[normalizedListFilters],
	);

	const {
		data: userMetadataGroupsList,
		refetch: refetchUserMetadataGroupsList,
	} = useUserMetadataGroupList(listInput, action === "list");

	const searchInput: MetadataGroupSearchInput = useMemo(() => {
		const lot = coreDetails.metadataGroupSourceLotMappings.find(
			(m) => m.source === normalizedSearchFilters.source,
		)?.lot;
		if (!lot) throw new Error("Invalid source selected");
		return {
			lot,
			source: normalizedSearchFilters.source,
			search: {
				page: normalizedSearchFilters.page,
				query: normalizedSearchFilters.query,
			},
		};
	}, [normalizedSearchFilters, coreDetails]);

	const { data: metadataGroupSearch } = useQuery({
		enabled: action === "search" && !!searchInput.lot,
		queryKey: queryFactory.media.metadataGroupSearch(searchInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(MetadataGroupSearchDocument, { input: searchInput })
				.then((data) => data.metadataGroupSearch),
	});

	const areListFiltersActive = isFilterChanged(
		normalizedListFilters,
		defaultListFilters,
	);
	const areSearchFiltersActive = isFilterChanged(
		normalizedSearchFilters,
		defaultSearchFilters,
	);
	const searchInputValue =
		action === "list"
			? normalizedListFilters.query
			: normalizedSearchFilters.query;

	const updateListFilters: FilterUpdateFunction<ListFilterState> = (
		key,
		value,
	) =>
		setListFilters((prev) => ({
			...defaultListFilters,
			...prev,
			[key]: value,
		}));

	const updateSearchFilters: FilterUpdateFunction<SearchFilterState> = (
		key,
		value,
	) =>
		setSearchFilters((prev) => ({
			...defaultSearchFilters,
			...prev,
			[key]: value,
		}));

	return (
		<>
			<CreateFilterPresetModal
				onSave={handleSaveListPreset}
				opened={listPresetModalOpened}
				onClose={closeListPresetModal}
				placeholder="e.g., Favorite Franchises"
			/>
			<CreateFilterPresetModal
				onSave={handleSaveSearchPreset}
				opened={searchPresetModalOpened}
				onClose={closeSearchPresetModal}
				placeholder="e.g., TMDB Collections"
			/>
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
							if (v) navigate($path("/media/groups/:action", { action: v }));
						}}
					>
						<Tabs.List style={{ alignItems: "center" }}>
							<Tabs.Tab value="list" leftSection={<IconListCheck size={24} />}>
								<Text>My Groups</Text>
							</Tabs.Tab>
							<Tabs.Tab value="search" leftSection={<IconSearch size={24} />}>
								<Text>Search</Text>
							</Tabs.Tab>
							<CreateButton
								to={$path("/media/groups/update/:action", { action: "create" })}
							/>
						</Tabs.List>
					</Tabs>
					<Group wrap="nowrap">
						<DebouncedSearchInput
							value={searchInputValue}
							placeholder="Search for groups"
							onChange={(value) => {
								if (action === "list") {
									updateListFilters("query", value);
									updateListFilters("page", 1);
								} else {
									updateSearchFilters("query", value);
									updateSearchFilters("page", 1);
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
										filters={normalizedListFilters}
										onFiltersChange={updateListFilters}
									/>
									<Divider my="sm" />
									<Button
										fullWidth
										variant="light"
										onClick={() => {
											closeFiltersModal();
											openListPresetModal();
										}}
									>
										Save current filters as preset
									</Button>
								</FiltersModal>
							</>
						) : null}
						{action === "search" ? (
							<>
								<Select
									data={metadataGroupSourceOptions}
									value={normalizedSearchFilters.source}
									onChange={(v) =>
										v && updateSearchFilters("source", v as MediaSource)
									}
								/>
								<ActionIcon
									onClick={openSearchFiltersModal}
									color={areSearchFiltersActive ? "blue" : "gray"}
								>
									<IconFilter size={24} />
								</ActionIcon>
								<FiltersModal
									opened={searchFiltersModalOpened}
									closeFiltersModal={closeSearchFiltersModal}
									resetFilters={() => setSearchFilters(defaultSearchFilters)}
								>
									<Button
										fullWidth
										variant="light"
										onClick={() => {
											closeSearchFiltersModal();
											openSearchPresetModal();
										}}
									>
										Save current filters as preset
									</Button>
								</FiltersModal>
							</>
						) : null}
					</Group>
					{action === "list" &&
					listPresets.filterPresets &&
					listPresets.filterPresets.response.length > 0 ? (
						<Box>
							<Chip.Group
								value={listPresets.activePresetId || undefined}
								key={listPresets.activePresetId || "groups-list-no-preset"}
								onChange={(value) => {
									if (!value) return;
									const preset = listPresets.filterPresets?.response.find(
										(p) => p.id === value,
									);
									if (preset)
										listPresets.applyPreset(preset.id, preset.filters);
								}}
							>
								<Group
									gap="xs"
									wrap="nowrap"
									ref={listPresetParent}
									style={{ overflowX: "auto" }}
								>
									{listPresets.filterPresets.response.map((preset) => (
										<FilterPresetChip
											id={preset.id}
											key={preset.id}
											name={preset.name}
											onDelete={listPresets.deletePreset}
										/>
									))}
								</Group>
							</Chip.Group>
						</Box>
					) : null}
					{action === "search" &&
					searchPresets.filterPresets &&
					searchPresets.filterPresets.response.length > 0 ? (
						<Box>
							<Chip.Group
								value={searchPresets.activePresetId || undefined}
								key={searchPresets.activePresetId || "groups-search-no-preset"}
								onChange={(value) => {
									if (!value) return;
									const preset = searchPresets.filterPresets?.response.find(
										(p) => p.id === value,
									);
									if (preset)
										searchPresets.applyPreset(preset.id, preset.filters);
								}}
							>
								<Group
									gap="xs"
									wrap="nowrap"
									ref={searchPresetParent}
									style={{ overflowX: "auto" }}
								>
									{searchPresets.filterPresets.response.map((preset) => (
										<FilterPresetChip
											id={preset.id}
											key={preset.id}
											name={preset.name}
											onDelete={searchPresets.deletePreset}
										/>
									))}
								</Group>
							</Chip.Group>
						</Box>
					) : null}

					{action === "list" ? (
						userMetadataGroupsList ? (
							<>
								<DisplayListDetailsAndRefresh
									cacheId={userMetadataGroupsList.cacheId}
									onRefreshButtonClicked={refetchUserMetadataGroupsList}
									total={userMetadataGroupsList.response.details.totalItems}
									isRandomSortOrderSelected={
										normalizedListFilters.sortBy ===
										PersonAndMetadataGroupsSortBy.Random
									}
								/>
								{userMetadataGroupsList.response.details.totalItems > 0 ? (
									<ApplicationGrid>
										{userMetadataGroupsList.response.items.map((gr) => (
											<MetadataGroupListItem key={gr} item={gr} />
										))}
									</ApplicationGrid>
								) : (
									<Text>No information to display</Text>
								)}
								<ApplicationPagination
									value={normalizedListFilters.page}
									onChange={(v) => updateListFilters("page", v)}
									totalItems={
										userMetadataGroupsList.response.details.totalItems
									}
								/>
							</>
						) : (
							<SkeletonLoader />
						)
					) : null}

					{action === "search" ? (
						metadataGroupSearch ? (
							<>
								<DisplayListDetailsAndRefresh
									total={metadataGroupSearch.response.details.totalItems}
								/>
								{metadataGroupSearch.response.details.totalItems > 0 ? (
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
									value={normalizedSearchFilters.page}
									onChange={(v) => updateSearchFilters("page", v)}
									totalItems={metadataGroupSearch.response.details.totalItems}
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
				{filters.sortBy !== PersonAndMetadataGroupsSortBy.Random ? (
					<SortOrderToggle
						currentOrder={filters.orderBy}
						onOrderChange={(order) => onFiltersChange("orderBy", order)}
					/>
				) : null}
			</Flex>
			<Divider />
			<CollectionsFilter
				applied={filters.collections}
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
			noEntityLot
			metadataGroupId={props.item}
			centerElement={
				bulkEditingState &&
				bulkEditingState.data.action === "add" &&
				!isAlreadyPresent ? (
					<ActionIcon
						color="green"
						variant={isAdded ? "filled" : "transparent"}
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
