import {
	ActionIcon,
	Box,
	Button,
	Checkbox,
	Container,
	Divider,
	Flex,
	Group,
	MultiSelect,
	Select,
	Stack,
	Tabs,
	Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import {
	EntityLot,
	GraphqlSortOrder,
	type MediaCollectionFilter,
	MediaGeneralFilter,
	MediaLot,
	MediaSortBy,
	MediaSource,
	MetadataSearchDocument,
	type MetadataSearchInput,
	type MetadataSearchQuery,
	UserMetadataListDocument,
	type UserMetadataListInput,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, cloneDeep, startCase } from "@ryot/ts-utils";
import {
	IconCheck,
	IconFilter,
	IconListCheck,
	IconPhotoPlus,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { $path } from "safe-routes";
import { useLocalStorage } from "usehooks-ts";
import {
	ApplicationPagination,
	BulkCollectionEditingAffix,
	DisplayListDetailsAndRefresh,
	ProRequiredAlert,
	SkeletonLoader,
} from "~/components/common";
import {
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { dayjsLib, getStartTimeFromRange } from "~/lib/shared/date-utils";
import { useCoreDetails } from "~/lib/shared/hooks";
import { getLot } from "~/lib/shared/media-utils";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	isFilterChanged,
} from "~/lib/shared/ui-utils";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	OnboardingTourStepTargets,
	TOUR_METADATA_TARGET_ID,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import { ApplicationTimeRange, type FilterUpdateFunction } from "~/lib/types";

interface ListFilterState {
	page: number;
	query: string;
	sortBy: MediaSortBy;
	endDateRange?: string;
	startDateRange?: string;
	sortOrder: GraphqlSortOrder;
	dateRange: ApplicationTimeRange;
	generalFilter: MediaGeneralFilter;
	collections: MediaCollectionFilter[];
}

interface SearchFilterState {
	page: number;
	query: string;
	source: MediaSource;
	igdbThemeIds?: string[];
	igdbGenreIds?: string[];
	igdbPlatformIds?: string[];
	igdbGameModeIds?: string[];
	igdbGameTypeIds?: string[];
	googleBooksPassRawQuery?: boolean;
	igdbAllowGamesWithParent?: boolean;
	igdbReleaseDateRegionIds?: string[];
}

const defaultListFilters: ListFilterState = {
	page: 1,
	query: "",
	collections: [],
	sortBy: MediaSortBy.LastUpdated,
	sortOrder: GraphqlSortOrder.Desc,
	generalFilter: MediaGeneralFilter.All,
	dateRange: ApplicationTimeRange.AllTime,
};

export const meta = () => {
	return [{ title: "Media | Ryot" }];
};

export default function Page(props: {
	params: { action: string; lot: string };
}) {
	const action = props.params.action;
	const lot = getLot(props.params.lot) as MediaLot;
	const coreDetails = useCoreDetails();
	const navigate = useNavigate();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [
		searchFiltersModalOpened,
		{ open: openSearchFiltersModal, close: closeSearchFiltersModal },
	] = useDisclosure(false);
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const metadataLotSourceMapping = coreDetails.metadataLotSourceMappings.find(
		(m) => m.lot === lot,
	);

	const [listFilters, setListFilters] = useLocalStorage<ListFilterState>(
		`MediaListFilters_${lot}`,
		defaultListFilters,
	);
	const defaultSearchFilters: SearchFilterState = {
		page: 1,
		query: "",
		source: metadataLotSourceMapping?.sources[0] || MediaSource.Tmdb,
	};
	const [searchFilters, setSearchFilters] = useLocalStorage<SearchFilterState>(
		`MediaSearchFilters_${lot}`,
		defaultSearchFilters,
	);

	const listInput: UserMetadataListInput = useMemo(
		() => ({
			lot,
			search: { page: listFilters.page, query: listFilters.query },
			sort: { order: listFilters.sortOrder, by: listFilters.sortBy },
			filter: {
				general: listFilters.generalFilter,
				collections: listFilters.collections,
				dateRange: {
					endDate: listFilters.endDateRange,
					startDate: listFilters.startDateRange,
				},
			},
		}),
		[lot, listFilters],
	);

	const searchInput: MetadataSearchInput = useMemo(
		() => ({
			lot,
			source: searchFilters.source,
			search: { page: searchFilters.page, query: searchFilters.query },
			sourceSpecifics: {
				googleBooks: { passRawQuery: searchFilters.googleBooksPassRawQuery },
				igdb: {
					filters: {
						themeIds: searchFilters.igdbThemeIds,
						genreIds: searchFilters.igdbGenreIds,
						platformIds: searchFilters.igdbPlatformIds,
						gameModeIds: searchFilters.igdbGameModeIds,
						gameTypeIds: searchFilters.igdbGameTypeIds,
						releaseDateRegionIds: searchFilters.igdbReleaseDateRegionIds,
						allowGamesWithParent: searchFilters.igdbAllowGamesWithParent,
					},
				},
			},
		}),
		[lot, searchFilters],
	);

	const { data: userMetadataList, refetch: refetchUserMetadataList } = useQuery(
		{
			enabled: action === "list",
			queryKey: queryFactory.media.userMetadataList(listInput).queryKey,
			queryFn: () =>
				clientGqlService
					.request(UserMetadataListDocument, { input: listInput })
					.then((data) => data.userMetadataList),
		},
	);

	const { data: metadataSearch } = useQuery({
		enabled: action === "search",
		queryKey: queryFactory.media.metadataSearch(searchInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(MetadataSearchDocument, { input: searchInput })
				.then((data) => data.metadataSearch),
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

	const isEligibleForNextTourStep = lot === MediaLot.AudioBook;

	return (
		<>
			<BulkCollectionEditingAffix
				bulkAddEntities={async () => {
					if (action !== "list") return [];
					const input = cloneDeep(listInput);
					input.search = { ...input.search, take: Number.MAX_SAFE_INTEGER };
					return await clientGqlService
						.request(UserMetadataListDocument, { input })
						.then((r) =>
							r.userMetadataList.response.items.map((m) => ({
								entityId: m,
								entityLot: EntityLot.Metadata,
							})),
						);
				}}
			/>
			<Container>
				<Tabs
					mt="sm"
					variant="default"
					value={action}
					onChange={(v) => {
						if (v) {
							navigate(
								$path("/media/:action/:lot", {
									action: v,
									lot: lot.toLowerCase(),
								}),
							);
							if (v === "search") {
								advanceOnboardingTourStep();
							}
						}
					}}
				>
					<Tabs.List mb="xs" style={{ alignItems: "center" }}>
						<Tabs.Tab value="list" leftSection={<IconListCheck size={24} />}>
							<Text>My {changeCase(lot.toLowerCase())}s</Text>
						</Tabs.Tab>
						<Tabs.Tab
							value="search"
							leftSection={<IconSearch size={24} />}
							className={OnboardingTourStepTargets.GoToAudiobooksSection}
						>
							<Text>Search</Text>
						</Tabs.Tab>
						<Box ml="auto" visibleFrom="md">
							<Button
								component={Link}
								variant="transparent"
								leftSection={<IconPhotoPlus />}
								to={$path(
									"/media/update/:action",
									{ action: "create" },
									{ lot },
								)}
							>
								Create
							</Button>
						</Box>
					</Tabs.List>
				</Tabs>

				<Stack>
					{action === "list" ? (
						userMetadataList ? (
							<>
								<Group wrap="nowrap">
									<DebouncedSearchInput
										value={listFilters.query}
										placeholder={`Sift through your ${changeCase(
											lot.toLowerCase(),
										).toLowerCase()}s`}
										onChange={(value) => {
											updateListFilters("query", value);
											updateListFilters("page", 1);
										}}
									/>
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
											lot={lot}
											filters={listFilters}
											onFiltersChange={updateListFilters}
										/>
									</FiltersModal>
								</Group>
								<DisplayListDetailsAndRefresh
									cacheId={userMetadataList.cacheId}
									onRefreshButtonClicked={refetchUserMetadataList}
									total={userMetadataList.response.details.totalItems}
									isRandomSortOrderSelected={
										listFilters.sortBy === MediaSortBy.Random
									}
								/>
								{(listFilters.startDateRange || listFilters.endDateRange) &&
								!coreDetails.isServerKeyValidated ? (
									<ProRequiredAlert alertText="Ryot Pro is required to filter by dates" />
								) : userMetadataList.response.details.totalItems > 0 ? (
									<ApplicationGrid
										className={OnboardingTourStepTargets.ShowAudiobooksListPage}
									>
										{userMetadataList.response.items.map((item) => (
											<MediaListItem key={item} item={item} />
										))}
									</ApplicationGrid>
								) : (
									<Text>You do not have any saved yet</Text>
								)}
								<ApplicationPagination
									value={listFilters.page}
									onChange={(v) => updateListFilters("page", v)}
									totalItems={userMetadataList.response.details.totalItems}
								/>
							</>
						) : (
							<SkeletonLoader />
						)
					) : null}
					{action === "search" ? (
						metadataSearch ? (
							<>
								<Flex gap="xs" direction={{ base: "column", md: "row" }}>
									<DebouncedSearchInput
										value={searchFilters.query}
										placeholder={`Search for ${changeCase(
											lot.toLowerCase(),
										).toLowerCase()}s`}
										onChange={(value) => {
											updateSearchFilters("query", value);
											updateSearchFilters("page", 1);
										}}
										tourControl={{
											target: OnboardingTourStepTargets.SearchAudiobook,
											onQueryChange: (query) => {
												if (query === TOUR_METADATA_TARGET_ID.toLowerCase()) {
													advanceOnboardingTourStep();
												}
											},
										}}
									/>
									<Group gap="xs" wrap="nowrap">
										{(metadataLotSourceMapping?.sources.length || 0) > 1 ? (
											<Select
												value={searchFilters.source}
												onChange={(v) =>
													v && updateSearchFilters("source", v as MediaSource)
												}
												data={metadataLotSourceMapping?.sources.map((o) => ({
													value: o,
													label: startCase(o.toLowerCase()),
												}))}
											/>
										) : null}
										<ActionIcon onClick={openSearchFiltersModal} color="gray">
											<IconFilter size={24} />
										</ActionIcon>
										<FiltersModal
											opened={searchFiltersModalOpened}
											closeFiltersModal={closeSearchFiltersModal}
											resetFilters={() =>
												setSearchFilters(defaultSearchFilters)
											}
										>
											<SearchFiltersModalForm
												filters={searchFilters}
												onFiltersChange={updateSearchFilters}
											/>
										</FiltersModal>
									</Group>
								</Flex>
								{metadataSearch.response.details.totalItems > 0 ? (
									<>
										<Box>
											<Text display="inline" fw="bold">
												{metadataSearch.response.details.totalItems}
											</Text>{" "}
											items found
										</Box>
										<ApplicationGrid>
											{metadataSearch.response.items.map((b, index) => (
												<MediaSearchItem
													key={b}
													item={b}
													isFirstItem={index === 0}
													isEligibleForNextTourStep={isEligibleForNextTourStep}
												/>
											))}
										</ApplicationGrid>
									</>
								) : (
									<Text>No media found matching your query</Text>
								)}
								<ApplicationPagination
									value={searchFilters.page}
									onChange={(v) => updateSearchFilters("page", v)}
									totalItems={metadataSearch.response.details.totalItems}
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

const MediaSearchItem = (props: {
	isFirstItem: boolean;
	isEligibleForNextTourStep: boolean;
	item: MetadataSearchQuery["metadataSearch"]["response"]["items"][number];
}) => {
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const tourControlTwo = props.isFirstItem
		? OnboardingTourStepTargets.OpenMetadataProgressForm
		: undefined;

	const tourControlThree = props.isFirstItem
		? OnboardingTourStepTargets.GoToAudiobooksSectionAgain
		: undefined;

	return (
		<MetadataDisplayItem
			metadataId={props.item}
			shouldHighlightNameIfInteracted
			bottomRightImageOverlayClassName={tourControlTwo}
			imageClassName={OnboardingTourStepTargets.GoToAudiobooksSectionAgain}
			onImageClickBehavior={async () => {
				if (tourControlThree) advanceOnboardingTourStep();
			}}
		/>
	);
};

interface FiltersModalFormProps {
	lot: MediaLot;
	filters: ListFilterState;
	onFiltersChange: FilterUpdateFunction<ListFilterState>;
}

const FiltersModalForm = (props: FiltersModalFormProps) => {
	const { filters, onFiltersChange } = props;

	return (
		<>
			<Select
				defaultValue={filters.generalFilter}
				data={convertEnumToSelectData(MediaGeneralFilter)}
				onChange={(v) => {
					v && onFiltersChange("generalFilter", v as MediaGeneralFilter);
				}}
			/>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					defaultValue={filters.sortBy}
					onChange={(v) => {
						v && onFiltersChange("sortBy", v as MediaSortBy);
					}}
					data={[
						{
							group: "Sort by",
							items: convertEnumToSelectData(MediaSortBy),
						},
					]}
				/>
				<ActionIcon
					onClick={() => {
						if (filters.sortOrder === GraphqlSortOrder.Asc)
							onFiltersChange("sortOrder", GraphqlSortOrder.Desc);
						else onFiltersChange("sortOrder", GraphqlSortOrder.Asc);
					}}
				>
					{filters.sortOrder === GraphqlSortOrder.Asc ? (
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
			<Divider />
			<Stack gap="xs">
				<Select
					size="xs"
					description="Finished between time range"
					data={Object.values(ApplicationTimeRange)}
					defaultValue={filters.dateRange}
					onChange={(v) => {
						const range = v as ApplicationTimeRange;
						const startDateRange = getStartTimeFromRange(range);
						onFiltersChange("dateRange", range);
						if (range === ApplicationTimeRange.Custom) return;

						onFiltersChange(
							"startDateRange",
							startDateRange?.format("YYYY-MM-DD") || "",
						);
						onFiltersChange(
							"endDateRange",
							range === ApplicationTimeRange.AllTime
								? ""
								: dayjsLib().format("YYYY-MM-DD"),
						);
					}}
				/>
				{filters.dateRange === ApplicationTimeRange.Custom ? (
					<DatePickerInput
						size="xs"
						type="range"
						description="Select custom dates"
						defaultValue={
							filters.startDateRange && filters.endDateRange
								? [
										new Date(filters.startDateRange),
										new Date(filters.endDateRange),
									]
								: undefined
						}
						onChange={(v) => {
							const start = v[0];
							const end = v[1];
							if (!start || !end) return;
							onFiltersChange(
								"startDateRange",
								dayjsLib(start).format("YYYY-MM-DD"),
							);
							onFiltersChange(
								"endDateRange",
								dayjsLib(end).format("YYYY-MM-DD"),
							);
						}}
					/>
				) : null}
			</Stack>
		</>
	);
};

interface IgdbMultiselectProps {
	label: string;
	valueKey: string;
	value?: string[];
	data: Array<{ id: number; name: string }>;
	onChange: (key: string, value: string[] | null) => void;
}

const IgdbMultiselect = (props: IgdbMultiselectProps) => {
	return (
		<MultiSelect
			size="xs"
			clearable
			searchable
			hidePickedOptions
			label={props.label}
			value={props.value}
			onChange={(v) => props.onChange(props.valueKey, v)}
			data={props.data.map((item) => ({
				label: item.name,
				value: item.id.toString(),
			}))}
		/>
	);
};

interface SearchFiltersModalFormProps {
	filters: SearchFilterState;
	onFiltersChange: FilterUpdateFunction<SearchFilterState>;
}

const SearchFiltersModalForm = (props: SearchFiltersModalFormProps) => {
	const { filters, onFiltersChange } = props;
	const coreDetails = useCoreDetails();

	const handleIgdbFilterChange = (key: string, value: string[] | null) => {
		onFiltersChange(key as keyof SearchFilterState, value);
	};

	return (
		<Stack gap="xs">
			{filters.source === MediaSource.GoogleBooks ? (
				<Checkbox
					label="Pass raw query"
					checked={filters.googleBooksPassRawQuery || false}
					onChange={(e) =>
						onFiltersChange("googleBooksPassRawQuery", e.target.checked)
					}
				/>
			) : filters.source === MediaSource.Igdb ? (
				<>
					<IgdbMultiselect
						label="Select themes"
						valueKey="igdbThemeIds"
						value={filters.igdbThemeIds}
						data={coreDetails.providerSpecifics.igdb.themes}
						onChange={handleIgdbFilterChange}
					/>
					<IgdbMultiselect
						label="Select genres"
						valueKey="igdbGenreIds"
						value={filters.igdbGenreIds}
						data={coreDetails.providerSpecifics.igdb.genres}
						onChange={handleIgdbFilterChange}
					/>
					<IgdbMultiselect
						label="Select platforms"
						valueKey="igdbPlatformIds"
						value={filters.igdbPlatformIds}
						data={coreDetails.providerSpecifics.igdb.platforms}
						onChange={handleIgdbFilterChange}
					/>
					<IgdbMultiselect
						label="Select game types"
						valueKey="igdbGameTypeIds"
						value={filters.igdbGameTypeIds}
						data={coreDetails.providerSpecifics.igdb.gameTypes}
						onChange={handleIgdbFilterChange}
					/>
					<IgdbMultiselect
						label="Select game modes"
						valueKey="igdbGameModeIds"
						value={filters.igdbGameModeIds}
						data={coreDetails.providerSpecifics.igdb.gameModes}
						onChange={handleIgdbFilterChange}
					/>
					<IgdbMultiselect
						label="Select release regions"
						valueKey="igdbReleaseDateRegionIds"
						value={filters.igdbReleaseDateRegionIds}
						data={coreDetails.providerSpecifics.igdb.releaseDateRegions}
						onChange={handleIgdbFilterChange}
					/>
					<Checkbox
						label="Allow games with parent"
						checked={filters.igdbAllowGamesWithParent || false}
						onChange={(e) =>
							onFiltersChange("igdbAllowGamesWithParent", e.target.checked)
						}
					/>
				</>
			) : (
				<Text>No filters are available</Text>
			)}
		</Stack>
	);
};

type MediaListItemProps = {
	item: string;
};

const MediaListItem = (props: MediaListItemProps) => {
	const bulkEditingCollection = useBulkEditCollection();
	const bulkEditingState = bulkEditingCollection.state;

	const becItem = { entityId: props.item, entityLot: EntityLot.Metadata };
	const isAlreadyPresent = bulkEditingCollection.isAlreadyPresent(becItem);
	const isAdded = bulkEditingCollection.isAdded(becItem);

	return (
		<MetadataDisplayItem
			rightLabelHistory
			metadataId={props.item}
			topRight={
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
