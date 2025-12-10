import {
	ActionIcon,
	Checkbox,
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
import {
	type inferParserType,
	parseAsInteger,
	parseAsJson,
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
import { PersonDisplayItem } from "~/components/media/display-items";
import { useFilterModals } from "~/lib/hooks/filters/use-modals";
import { useFilterPresets } from "~/lib/hooks/filters/use-presets";
import { useFiltersState } from "~/lib/hooks/filters/use-state";
import { useCoreDetails, useUserPeopleList } from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { useBulkEditCollection } from "~/lib/state/collection";

const defaultListQueryState = {
	page: parseAsInteger.withDefault(1),
	query: parseAsString.withDefault(""),
	orderBy: parseAsStringEnum(Object.values(GraphqlSortOrder)).withDefault(
		GraphqlSortOrder.Desc,
	),
	collections: parseAsJson<MediaCollectionFilter[]>((val) =>
		Array.isArray(val) ? (val as MediaCollectionFilter[]) : null,
	).withDefault([]),
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
	sourceSpecifics: parseAsJson<{
		isTvdbCompany?: boolean;
		isTmdbCompany?: boolean;
		isAnilistStudio?: boolean;
		isGiantBombCompany?: boolean;
		isHardcoverPublisher?: boolean;
	}>((val) =>
		typeof val === "object" && val !== null ? val : null,
	).withDefault({}),
};

type ListFilterState = inferParserType<typeof defaultListQueryState>;
type SearchFilterState = inferParserType<typeof defaultSearchQueryState>;

type FilterUpdateFunction<T> = <K extends keyof T>(key: K, value: T[K]) => void;

export const meta = () => {
	return [{ title: "People | Ryot" }];
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

	const listPresets = useFilterPresets({
		filters: listFilters,
		enabled: action === "list",
		updateFilters: updateListFilters,
		contextType: FilterPresetContextType.PeopleList,
	});

	const searchPresets = useFilterPresets({
		filters: searchFilters,
		enabled: action === "search",
		updateFilters: updateSearchFilters,
		contextType: FilterPresetContextType.PeopleSearch,
	});

	const listInput: UserPeopleListInput = useMemo(
		() => ({
			filter: { collections: listFilters.collections },
			sort: { by: listFilters.sortBy, order: listFilters.orderBy },
			search: { page: listFilters.page, query: listFilters.query },
		}),
		[listFilters],
	);

	const { data: userPeopleList, refetch: refetchUserPeopleList } =
		useUserPeopleList(listInput, action === "list");

	const searchInput = useMemo(
		() => ({
			source: searchFilters.source,
			sourceSpecifics: searchFilters.sourceSpecifics,
			search: { page: searchFilters.page, query: searchFilters.query },
		}),
		[searchFilters],
	);

	const { data: peopleSearch } = useQuery({
		enabled: action === "search",
		queryKey: queryFactory.media.peopleSearch(searchInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(PeopleSearchDocument, { input: searchInput })
				.then((data) => data.peopleSearch),
	});

	const searchInputValue =
		action === "list" ? listFilters.query : searchFilters.query;

	return (
		<>
			<FilterPresetModalManager
				presetManager={listPresets}
				opened={listModals.presetModal.opened}
				onClose={listModals.presetModal.close}
				placeholder="e.g., Favorite Directors"
			/>
			<FilterPresetModalManager
				presetManager={searchPresets}
				opened={searchModals.presetModal.opened}
				onClose={searchModals.presetModal.close}
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
									data={coreDetails.peopleSearchSources.map((o) => ({
										value: o,
										label: startCase(o.toLowerCase()),
									}))}
									onChange={(v) => {
										v &&
											updateSearchFilters({
												source: v as MediaSource,
												page: 1,
											});
									}}
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
								>
									<SearchFiltersModalForm
										filters={searchFilters}
										onFiltersChange={(key, value) =>
											updateSearchFilters({ [key]: value })
										}
									/>
								</FiltersModal>
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
						userPeopleList ? (
							<>
								<DisplayListDetailsAndRefresh
									cacheId={userPeopleList.cacheId}
									onRefreshButtonClicked={refetchUserPeopleList}
									total={userPeopleList.response.details.totalItems}
									isRandomSortOrderSelected={
										listFilters.sortBy === PersonAndMetadataGroupsSortBy.Random
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
									value={listFilters.page}
									onChange={(page) => updateListFilters({ page })}
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
									value={searchFilters.page}
									onChange={(page) => updateSearchFilters({ page })}
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
	onFiltersChange: FilterUpdateFunction<SearchFilterState>;
}

const SearchFiltersModalForm = (props: SearchFiltersModalFormProps) => {
	const { filters, onFiltersChange } = props;

	return (
		<Stack gap="md">
			{filters.source === MediaSource.Tvdb ? (
				<Checkbox
					label="Company"
					checked={filters.sourceSpecifics.isTvdbCompany || false}
					onChange={(e) =>
						onFiltersChange("sourceSpecifics", {
							isTvdbCompany: e.target.checked,
						})
					}
				/>
			) : null}
			{filters.source === MediaSource.Tmdb ? (
				<Checkbox
					label="Company"
					checked={filters.sourceSpecifics.isTmdbCompany || false}
					onChange={(e) =>
						onFiltersChange("sourceSpecifics", {
							isTmdbCompany: e.target.checked,
						})
					}
				/>
			) : null}
			{filters.source === MediaSource.Anilist ? (
				<Checkbox
					label="Studio"
					checked={filters.sourceSpecifics.isAnilistStudio || false}
					onChange={(e) =>
						onFiltersChange("sourceSpecifics", {
							isAnilistStudio: e.target.checked,
						})
					}
				/>
			) : null}
			{filters.source === MediaSource.Hardcover ? (
				<Checkbox
					label="Publisher"
					checked={filters.sourceSpecifics.isHardcoverPublisher || false}
					onChange={(e) =>
						onFiltersChange("sourceSpecifics", {
							isHardcoverPublisher: e.target.checked,
						})
					}
				/>
			) : null}
			{filters.source === MediaSource.GiantBomb ? (
				<Checkbox
					label="Company"
					checked={filters.sourceSpecifics.isGiantBombCompany || false}
					onChange={(e) =>
						onFiltersChange("sourceSpecifics", {
							isGiantBombCompany: e.target.checked,
						})
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
