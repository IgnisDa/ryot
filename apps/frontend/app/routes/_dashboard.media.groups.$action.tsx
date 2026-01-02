import {
	ActionIcon,
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
import {
	EntityLot,
	FilterPresetContextType,
	GraphqlSortOrder,
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
import {
	type inferParserType,
	parseAsInteger,
	parseAsString,
	parseAsStringEnum,
} from "nuqs";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import {
	ApplicationPagination,
	CreateButton,
	DisplayListDetailsAndRefresh,
	SkeletonLoader,
} from "~/components/common";
import { BulkCollectionEditingAffix } from "~/components/common/bulk-collection-editing-affix";
import {
	FilterPresetBar,
	FilterPresetModalManager,
} from "~/components/common/filter-presets";
import {
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
	SortOrderToggle,
} from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataGroupDisplayItem } from "~/components/media/display-items";
import type { FilterUpdateFunction } from "~/lib/hooks/filters/types";
import { useFilterModals } from "~/lib/hooks/filters/use-modals";
import { useFilterPresets } from "~/lib/hooks/filters/use-presets";
import { useFiltersState } from "~/lib/hooks/filters/use-state";
import { useCoreDetails, useUserMetadataGroupList } from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { parseAsCollectionsFilter } from "~/lib/shared/validation";
import { useBulkEditCollection } from "~/lib/state/collection";

const defaultListQueryState = {
	page: parseAsInteger.withDefault(1),
	query: parseAsString.withDefault(""),
	collections: parseAsCollectionsFilter.withDefault([]),
	orderBy: parseAsStringEnum(Object.values(GraphqlSortOrder)).withDefault(
		GraphqlSortOrder.Desc,
	),
	sortBy: parseAsStringEnum(
		Object.values(PersonAndMetadataGroupsSortBy),
	).withDefault(PersonAndMetadataGroupsSortBy.AssociatedEntityCount),
};

const defaultSearchQueryState = {
	page: parseAsInteger.withDefault(1),
	query: parseAsString.withDefault(""),
	source: parseAsStringEnum(Object.values(MediaSource)).withDefault(
		MediaSource.Tmdb,
	),
};

type ListFilterState = inferParserType<typeof defaultListQueryState>;

export const meta = () => {
	return [{ title: "Media Groups | Ryot" }];
};

export default function Page(props: { params: { action: string } }) {
	const navigate = useNavigate();
	const action = props.params.action;
	const coreDetails = useCoreDetails();

	const listModals = useFilterModals();
	const searchModals = useFilterModals();

	const {
		filters: listFilters,
		resetFilters: resetListFilters,
		updateFilters: updateListFilters,
		haveFiltersChanged: haveListFiltersChanged,
	} = useFiltersState(defaultListQueryState);

	const {
		filters: searchFilters,
		resetFilters: resetSearchFilters,
		updateFilters: updateSearchFilters,
		haveFiltersChanged: haveSearchFiltersChanged,
	} = useFiltersState(defaultSearchQueryState);

	const metadataGroupSourceOptions = useMemo(
		() =>
			coreDetails.metadataGroupSourceLotMappings.map((o) => ({
				value: o.source.toString(),
				label: startCase(o.source.toLowerCase()),
			})),
		[coreDetails.metadataGroupSourceLotMappings],
	);

	const listPresets = useFilterPresets({
		filters: listFilters,
		enabled: action === "list",
		updateFilters: updateListFilters,
		contextType: FilterPresetContextType.MetadataGroupsList,
	});

	const searchPresets = useFilterPresets({
		filters: searchFilters,
		enabled: action === "search",
		updateFilters: updateSearchFilters,
		contextType: FilterPresetContextType.MetadataGroupsSearch,
	});

	const listInput: UserMetadataGroupsListInput = useMemo(
		() => ({
			filter: { collections: listFilters.collections },
			sort: { by: listFilters.sortBy, order: listFilters.orderBy },
			search: { page: listFilters.page, query: listFilters.query },
		}),
		[listFilters],
	);

	const {
		data: userMetadataGroupsList,
		refetch: refetchUserMetadataGroupsList,
	} = useUserMetadataGroupList(listInput, action === "list");

	const searchInput: MetadataGroupSearchInput = useMemo(() => {
		const lot = coreDetails.metadataGroupSourceLotMappings.find(
			(m) => m.source === searchFilters.source,
		)?.lot;
		if (!lot) throw new Error("Invalid source selected");
		return {
			lot,
			source: searchFilters.source,
			search: { page: searchFilters.page, query: searchFilters.query },
		};
	}, [searchFilters, coreDetails]);

	const { data: metadataGroupSearch } = useQuery({
		enabled: action === "search" && !!searchInput.lot,
		queryKey: queryFactory.media.metadataGroupSearch(searchInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(MetadataGroupSearchDocument, { input: searchInput })
				.then((data) => data.metadataGroupSearch),
	});

	const searchInputValue =
		action === "list" ? listFilters.query : searchFilters.query;

	return (
		<>
			<FilterPresetModalManager
				presetManager={listPresets}
				opened={listModals.presetModal.opened}
				onClose={listModals.presetModal.close}
				placeholder="e.g., Favorite Franchises"
			/>
			<FilterPresetModalManager
				presetManager={searchPresets}
				placeholder="e.g., TMDB Collections"
				opened={searchModals.presetModal.opened}
				onClose={searchModals.presetModal.close}
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
								if (action === "list") updateListFilters({ query: value });
								else updateSearchFilters({ query: value });
							}}
						/>
						{action === "list" ? (
							<>
								<ActionIcon
									onClick={listModals.filtersModal.open}
									color={haveListFiltersChanged ? "blue" : "gray"}
								>
									<IconFilter size={24} />
								</ActionIcon>
								<FiltersModal
									resetFilters={resetListFilters}
									opened={listModals.filtersModal.opened}
									onSavePreset={listModals.presetModal.open}
									closeFiltersModal={listModals.filtersModal.close}
								>
									<FiltersModalForm
										filters={listFilters}
										onFiltersChange={(key, value) =>
											updateListFilters({ [key]: value })
										}
									/>
								</FiltersModal>
							</>
						) : null}
						{action === "search" ? (
							<>
								<Select
									value={searchFilters.source}
									data={metadataGroupSourceOptions}
									onChange={(v) =>
										v && updateSearchFilters({ source: v as MediaSource })
									}
								/>
								<ActionIcon
									onClick={searchModals.filtersModal.open}
									color={haveSearchFiltersChanged ? "blue" : "gray"}
								>
									<IconFilter size={24} />
								</ActionIcon>
								<FiltersModal
									resetFilters={resetSearchFilters}
									opened={searchModals.filtersModal.opened}
									onSavePreset={searchModals.presetModal.open}
									closeFiltersModal={searchModals.filtersModal.close}
								/>
							</>
						) : null}
					</Group>
					{action === "list" ? (
						<FilterPresetBar presetManager={listPresets} />
					) : null}
					{action === "search" ? (
						<FilterPresetBar presetManager={searchPresets} />
					) : null}

					{action === "list" ? (
						userMetadataGroupsList ? (
							<>
								<DisplayListDetailsAndRefresh
									cacheId={userMetadataGroupsList.cacheId}
									onRefreshButtonClicked={refetchUserMetadataGroupsList}
									total={userMetadataGroupsList.response.details.totalItems}
									isRandomSortOrderSelected={
										listFilters.sortBy === PersonAndMetadataGroupsSortBy.Random
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
									value={listFilters.page}
									onChange={(page) => updateListFilters({ page })}
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
									value={searchFilters.page}
									onChange={(page) => updateSearchFilters({ page })}
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

type MetadataGroupListItemProps = { item: string };

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
