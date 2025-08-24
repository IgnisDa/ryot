import {
	ActionIcon,
	Box,
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
import { useDisclosure } from "@mantine/hooks";
import {
	EntityLot,
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
import { PersonDisplayItem } from "~/components/media/display-items";
import { useCoreDetails } from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	isFilterChanged,
} from "~/lib/shared/ui-utils";
import { useBulkEditCollection } from "~/lib/state/collection";
import type { FilterUpdateFunction } from "~/lib/types";

interface ListFilterState {
	orderBy: GraphqlSortOrder;
	collections: MediaCollectionFilter[];
	sortBy: PersonAndMetadataGroupsSortBy;
}

interface SearchFilterState {
	query?: string;
	source: MediaSource;
	sourceSpecifics: {
		isTmdbCompany?: boolean;
		isAnilistStudio?: boolean;
		isGiantBombCompany?: boolean;
		isHardcoverPublisher?: boolean;
	};
}

const defaultListFilters: ListFilterState = {
	collections: [],
	orderBy: GraphqlSortOrder.Desc,
	sortBy: PersonAndMetadataGroupsSortBy.AssociatedEntityCount,
};

const defaultSearchFilters: SearchFilterState = {
	sourceSpecifics: {},
	source: MediaSource.Tmdb,
};

export const meta = () => {
	return [{ title: "People | Ryot" }];
};

export default function Page(props: { params: { action: string } }) {
	const navigate = useNavigate();
	const coreDetails = useCoreDetails();
	const action = props.params.action;

	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [
		searchFiltersModalOpened,
		{ open: openSearchFiltersModal, close: closeSearchFiltersModal },
	] = useDisclosure(false);

	const [listFilters, setListFilters] = useLocalStorage<ListFilterState>(
		"PeopleListFilters",
		defaultListFilters,
	);
	const [searchFilters, setSearchFilters] = useLocalStorage<SearchFilterState>(
		"PeopleSearchFilters",
		defaultSearchFilters,
	);
	const [searchQuery, setSearchQuery] = useLocalStorage(
		"PeopleSearchQuery",
		"",
	);
	const [currentPage, setCurrentPage] = useLocalStorage("PeopleCurrentPage", 1);

	const listInput: UserPeopleListInput = useMemo(
		() => ({
			filter: { collections: listFilters.collections },
			sort: { by: listFilters.sortBy, order: listFilters.orderBy },
			search: { page: currentPage, query: searchQuery },
		}),
		[listFilters, searchQuery, currentPage],
	);

	const { data: userPeopleList, refetch: refetchUserPeopleList } = useQuery({
		enabled: action === "list",
		queryKey: queryFactory.media.userPeopleList(listInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(UserPeopleListDocument, { input: listInput })
				.then((data) => data.userPeopleList),
	});

	const searchInput = useMemo(
		() => ({
			source: searchFilters.source,
			sourceSpecifics: searchFilters.sourceSpecifics,
			search: { page: currentPage, query: searchQuery },
		}),
		[searchFilters, searchQuery, currentPage],
	);

	const { data: peopleSearch } = useQuery({
		enabled: action === "search",
		queryKey: queryFactory.media.peopleSearch(searchInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(PeopleSearchDocument, { input: searchInput })
				.then((data) => data.peopleSearch),
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

	const updateSearchSourceSpecifics = (key: string, value: boolean) => {
		setSearchFilters((prev) => ({
			...prev,
			sourceSpecifics: { ...prev.sourceSpecifics, [key]: value },
		}));
	};

	return (
		<>
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
						</Tabs.List>
					</Tabs>

					<Group wrap="nowrap">
						<DebouncedSearchInput
							placeholder="Search for people"
							initialValue={searchQuery}
							onChange={(value) => {
								setSearchQuery(value);
								setCurrentPage(1);
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
							<>
								<Select
									value={searchFilters.source}
									onChange={(v) =>
										v && updateSearchFilters("source", v as MediaSource)
									}
									data={coreDetails.peopleSearchSources.map((o) => ({
										value: o,
										label: startCase(o.toLowerCase()),
									}))}
								/>
								<ActionIcon color="gray" onClick={openSearchFiltersModal}>
									<IconFilter size={24} />
								</ActionIcon>
								<FiltersModal
									opened={searchFiltersModalOpened}
									closeFiltersModal={closeSearchFiltersModal}
									resetFilters={() => setSearchFilters(defaultSearchFilters)}
								>
									<SearchFiltersModalForm
										filters={searchFilters}
										onFiltersChange={updateSearchSourceSpecifics}
									/>
								</FiltersModal>
							</>
						) : null}
					</Group>
					{action === "list" ? (
						userPeopleList ? (
							<>
								<DisplayListDetailsAndRefresh
									cacheId={userPeopleList.cacheId}
									total={userPeopleList.response.details.totalItems}
									onRefreshButtonClicked={refetchUserPeopleList}
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
									value={currentPage}
									onChange={setCurrentPage}
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
								<Box>
									<Text display="inline" fw="bold">
										{peopleSearch.response.details.totalItems}
									</Text>{" "}
									items found
								</Box>
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
									value={currentPage}
									onChange={setCurrentPage}
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
