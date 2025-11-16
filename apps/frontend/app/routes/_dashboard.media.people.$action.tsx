import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Box,
	Button,
	Checkbox,
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
	PeopleSearchDocument,
	PersonAndMetadataGroupsSortBy,
	UserPeopleListDocument,
	type UserPeopleListInput,
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
import { PersonDisplayItem } from "~/components/media/display-items";
import { useFilterPresets } from "~/lib/hooks/use-filter-presets";
import { useCoreDetails, useUserPeopleList } from "~/lib/shared/hooks";
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
	sourceSpecifics: {
		isTvdbCompany?: boolean;
		isTmdbCompany?: boolean;
		isAnilistStudio?: boolean;
		isGiantBombCompany?: boolean;
		isHardcoverPublisher?: boolean;
	};
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
	sourceSpecifics: {},
	source: MediaSource.Tmdb,
};

export const meta = () => {
	return [{ title: "People | Ryot" }];
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
		"PeopleListFilters",
		defaultListFilters,
	);
	const [searchFilters, setSearchFilters] = useLocalStorage<SearchFilterState>(
		"PeopleSearchFilters",
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

	const setListFiltersState = (filters: ListFilterState) =>
		setListFilters({ ...defaultListFilters, ...filters });

	const setSearchFiltersState = (filters: SearchFilterState) =>
		setSearchFilters({ ...defaultSearchFilters, ...filters });

	const listPresets = useFilterPresets({
		enabled: action === "list",
		filters: normalizedListFilters,
		setFilters: setListFiltersState,
		storageKeyPrefix: "PeopleListActivePreset",
		contextType: FilterPresetContextType.PeopleList,
	});

	const searchPresets = useFilterPresets({
		enabled: action === "search",
		filters: normalizedSearchFilters,
		setFilters: setSearchFiltersState,
		storageKeyPrefix: "PeopleSearchActivePreset",
		contextType: FilterPresetContextType.PeopleSearch,
	});

	const handleSaveListPreset = async (name: string) => {
		await listPresets.savePreset(name);
		closeListPresetModal();
	};

	const handleSaveSearchPreset = async (name: string) => {
		await searchPresets.savePreset(name);
		closeSearchPresetModal();
	};

	const listInput: UserPeopleListInput = useMemo(
		() => ({
			filter: { collections: normalizedListFilters.collections },
			sort: {
				by: normalizedListFilters.sortBy,
				order: normalizedListFilters.orderBy,
			},
			search: {
				page: normalizedListFilters.page,
				query: normalizedListFilters.query,
			},
		}),
		[normalizedListFilters],
	);

	const { data: userPeopleList, refetch: refetchUserPeopleList } =
		useUserPeopleList(listInput, action === "list");

	const searchInput = useMemo(
		() => ({
			source: normalizedSearchFilters.source,
			sourceSpecifics: normalizedSearchFilters.sourceSpecifics,
			search: {
				page: normalizedSearchFilters.page,
				query: normalizedSearchFilters.query,
			},
		}),
		[normalizedSearchFilters],
	);

	const { data: peopleSearch } = useQuery({
		enabled: action === "search",
		queryKey: queryFactory.media.peopleSearch(searchInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(PeopleSearchDocument, { input: searchInput })
				.then((data) => data.peopleSearch),
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

	const updateSearchSourceSpecifics = (key: string, value: boolean) => {
		setSearchFilters((prev) => ({
			...defaultSearchFilters,
			...prev,
			sourceSpecifics: {
				...defaultSearchFilters.sourceSpecifics,
				...prev.sourceSpecifics,
				[key]: value,
			},
		}));
	};

	return (
		<>
			<CreateFilterPresetModal
				onSave={handleSaveListPreset}
				opened={listPresetModalOpened}
				onClose={closeListPresetModal}
				placeholder="e.g., Favorite Directors"
			/>
			<CreateFilterPresetModal
				onSave={handleSaveSearchPreset}
				opened={searchPresetModalOpened}
				onClose={closeSearchPresetModal}
				placeholder="e.g., TMDB Casting Directors"
			/>
			<BulkCollectionEditingAffix
				bulkAddEntities={async () => {
					if (action !== "list") return [];
					const input = cloneDeep(listInput);
					input.search = { ...input.search, take: Number.MAX_SAFE_INTEGER };
					return await clientGqlService
						.request(UserPeopleListDocument, { input })
						.then((r) =>
							r.userPeopleList.response.items.map((p) => ({
								entityId: p,
								entityLot: EntityLot.Person,
							})),
						);
				}}
			/>
			<Container>
				<Stack>
					<Title>People</Title>
					<Tabs
						variant="default"
						value={action}
						onChange={(v) => {
							if (v) navigate($path("/media/people/:action", { action: v }));
						}}
					>
						<Tabs.List style={{ alignItems: "center" }}>
							<Tabs.Tab value="list" leftSection={<IconListCheck size={24} />}>
								<Text>My People</Text>
							</Tabs.Tab>
							<Tabs.Tab value="search" leftSection={<IconSearch size={24} />}>
								<Text>Search</Text>
							</Tabs.Tab>
							<CreateButton
								to={$path("/media/people/update/:action", { action: "create" })}
							/>
						</Tabs.List>
					</Tabs>

					<Group wrap="nowrap">
						<DebouncedSearchInput
							value={searchInputValue}
							placeholder="Search for people"
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
									value={normalizedSearchFilters.source}
									onChange={(v) => {
										updateSearchFilters("source", v as MediaSource);
										updateSearchFilters("page", 1);
									}}
									data={coreDetails.peopleSearchSources.map((o) => ({
										value: o,
										label: startCase(o.toLowerCase()),
									}))}
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
									<SearchFiltersModalForm
										filters={normalizedSearchFilters}
										onFiltersChange={updateSearchSourceSpecifics}
									/>
									<Divider my="sm" />
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
								key={listPresets.activePresetId || "people-list-no-preset"}
								value={listPresets.activePresetId || undefined}
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
								key={searchPresets.activePresetId || "people-search-no-preset"}
								value={searchPresets.activePresetId || undefined}
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
						userPeopleList ? (
							<>
								<DisplayListDetailsAndRefresh
									cacheId={userPeopleList.cacheId}
									total={userPeopleList.response.details.totalItems}
									onRefreshButtonClicked={refetchUserPeopleList}
									isRandomSortOrderSelected={
										normalizedListFilters.sortBy ===
										PersonAndMetadataGroupsSortBy.Random
									}
								/>
								{userPeopleList.response.details.totalItems > 0 ? (
									<ApplicationGrid>
										{userPeopleList.response.items.map((person) => (
											<PersonListItem key={person} item={person} />
										))}
									</ApplicationGrid>
								) : (
									<Text>No information to display</Text>
								)}
								<ApplicationPagination
									value={normalizedListFilters.page}
									onChange={(v) => updateListFilters("page", v)}
									totalItems={userPeopleList.response.details.totalItems}
								/>
							</>
						) : (
							<SkeletonLoader />
						)
					) : null}

					{action === "search" ? (
						peopleSearch ? (
							<>
								<DisplayListDetailsAndRefresh
									total={peopleSearch.response.details.totalItems}
								/>
								{peopleSearch.response.details.totalItems > 0 ? (
									<ApplicationGrid>
										{peopleSearch.response.items.map((person) => (
											<PersonDisplayItem
												key={person}
												personId={person}
												shouldHighlightNameIfInteracted
											/>
										))}
									</ApplicationGrid>
								) : (
									<Text>No people found matching your query</Text>
								)}
								<ApplicationPagination
									value={normalizedSearchFilters.page}
									onChange={(v) => updateSearchFilters("page", v)}
									totalItems={peopleSearch.response.details.totalItems}
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

interface SearchFiltersModalFormProps {
	filters: SearchFilterState;
	onFiltersChange: (key: string, value: boolean) => void;
}

const SearchFiltersModalForm = (props: SearchFiltersModalFormProps) => {
	const { filters, onFiltersChange } = props;

	return (
		<Stack gap="md">
			{filters.source === MediaSource.Tvdb ? (
				<Checkbox
					label="Company"
					checked={filters.sourceSpecifics.isTvdbCompany || false}
					onChange={(e) => onFiltersChange("isTvdbCompany", e.target.checked)}
				/>
			) : null}
			{filters.source === MediaSource.Tmdb ? (
				<Checkbox
					label="Company"
					checked={filters.sourceSpecifics.isTmdbCompany || false}
					onChange={(e) => onFiltersChange("isTmdbCompany", e.target.checked)}
				/>
			) : null}
			{filters.source === MediaSource.Anilist ? (
				<Checkbox
					label="Studio"
					checked={filters.sourceSpecifics.isAnilistStudio || false}
					onChange={(e) => onFiltersChange("isAnilistStudio", e.target.checked)}
				/>
			) : null}
			{filters.source === MediaSource.Hardcover ? (
				<Checkbox
					label="Publisher"
					checked={filters.sourceSpecifics.isHardcoverPublisher || false}
					onChange={(e) =>
						onFiltersChange("isHardcoverPublisher", e.target.checked)
					}
				/>
			) : null}
			{filters.source === MediaSource.GiantBomb ? (
				<Checkbox
					label="Company"
					checked={filters.sourceSpecifics.isGiantBombCompany || false}
					onChange={(e) =>
						onFiltersChange("isGiantBombCompany", e.target.checked)
					}
				/>
			) : null}
		</Stack>
	);
};

type PersonListItemProps = {
	item: string;
};

const PersonListItem = (props: PersonListItemProps) => {
	const bulkEditingCollection = useBulkEditCollection();
	const bulkEditingState = bulkEditingCollection.state;

	const becItem = { entityId: props.item, entityLot: EntityLot.Person };
	const isAlreadyPresent = bulkEditingCollection.isAlreadyPresent(becItem);
	const isAdded = bulkEditingCollection.isAdded(becItem);

	return (
		<PersonDisplayItem
			personId={props.item}
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
