import {
	ActionIcon,
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
import {
	EntityLot,
	FilterPresetContextType,
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
	IconSearch,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import {
	ApplicationPagination,
	CreateButton,
	DisplayListDetailsAndRefresh,
	ProRequiredAlert,
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
import { MetadataDisplayItem } from "~/components/media/display-items";
import type { FilterUpdateFunction } from "~/lib/hooks/filters/types";
import { useFilterModals } from "~/lib/hooks/filters/use-modals";
import { useFilterPresets } from "~/lib/hooks/filters/use-presets";
import { useFilterState } from "~/lib/hooks/filters/use-state";
import { dayjsLib, getStartTimeFromRange } from "~/lib/shared/date-utils";
import { useCoreDetails, useUserMetadataList } from "~/lib/shared/hooks";
import { getLot } from "~/lib/shared/media-utils";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	OnboardingTourStepTargets,
	TOUR_METADATA_TARGET_ID,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import { ApplicationTimeRange } from "~/lib/types";

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
	const navigate = useNavigate();
	const action = props.params.action;
	const coreDetails = useCoreDetails();
	const lot = getLot(props.params.lot) as MediaLot;
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const metadataLotSourceMapping = coreDetails.metadataLotSourceMappings.find(
		(m) => m.lot === lot,
	);

	const listModals = useFilterModals();
	const searchModals = useFilterModals();

	const listState = useFilterState({
		storageKey: `MediaListFilters_${lot}`,
		defaultFilters: defaultListFilters,
	});

	const defaultSearchFilters: SearchFilterState = {
		page: 1,
		query: "",
		source: metadataLotSourceMapping?.sources[0] || MediaSource.Tmdb,
	};

	const searchState = useFilterState({
		storageKey: `MediaSearchFilters_${lot}`,
		defaultFilters: defaultSearchFilters,
	});

	const listPresets = useFilterPresets({
		enabled: action === "list",
		contextInformation: { lot },
		filters: listState.normalizedFilters,
		setFilters: listState.setFiltersState,
		contextType: FilterPresetContextType.MetadataList,
	});

	const searchPresets = useFilterPresets({
		contextInformation: { lot },
		enabled: action === "search",
		filters: searchState.normalizedFilters,
		setFilters: searchState.setFiltersState,
		contextType: FilterPresetContextType.MetadataSearch,
	});

	const listInput: UserMetadataListInput = useMemo(
		() => ({
			lot,
			search: {
				page: listState.normalizedFilters.page,
				query: listState.normalizedFilters.query,
			},
			sort: {
				order: listState.normalizedFilters.sortOrder,
				by: listState.normalizedFilters.sortBy,
			},
			filter: {
				general: listState.normalizedFilters.generalFilter,
				collections: listState.normalizedFilters.collections,
				dateRange: {
					endDate: listState.normalizedFilters.endDateRange || undefined,
					startDate: listState.normalizedFilters.startDateRange || undefined,
				},
			},
		}),
		[lot, listState.normalizedFilters],
	);

	const searchInput: MetadataSearchInput = useMemo(
		() => ({
			lot,
			source: searchState.normalizedFilters.source,
			search: {
				page: searchState.normalizedFilters.page,
				query: searchState.normalizedFilters.query,
			},
			sourceSpecifics: {
				googleBooks: {
					passRawQuery: searchState.normalizedFilters.googleBooksPassRawQuery,
				},
				igdb: {
					filters: {
						themeIds: searchState.normalizedFilters.igdbThemeIds,
						genreIds: searchState.normalizedFilters.igdbGenreIds,
						platformIds: searchState.normalizedFilters.igdbPlatformIds,
						gameModeIds: searchState.normalizedFilters.igdbGameModeIds,
						gameTypeIds: searchState.normalizedFilters.igdbGameTypeIds,
						releaseDateRegionIds:
							searchState.normalizedFilters.igdbReleaseDateRegionIds,
						allowGamesWithParent:
							searchState.normalizedFilters.igdbAllowGamesWithParent,
					},
				},
			},
		}),
		[lot, searchState.normalizedFilters],
	);

	const { data: userMetadataList, refetch: refetchUserMetadataList } =
		useUserMetadataList(listInput, action === "list");

	const { data: metadataSearch } = useQuery({
		enabled: action === "search",
		queryKey: queryFactory.media.metadataSearch(searchInput).queryKey,
		queryFn: () =>
			clientGqlService
				.request(MetadataSearchDocument, { input: searchInput })
				.then((data) => data.metadataSearch),
	});

	const isEligibleForNextTourStep = lot === MediaLot.AudioBook;

	return (
		<>
			<FilterPresetModalManager
				presetManager={listPresets}
				placeholder="e.g., Unfinished Books"
				opened={listModals.presetModal.opened}
				onClose={listModals.presetModal.close}
			/>
			<FilterPresetModalManager
				presetManager={searchPresets}
				placeholder="e.g., RPG Games on PS5"
				opened={searchModals.presetModal.opened}
				onClose={searchModals.presetModal.close}
			/>
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
					value={action}
					variant="default"
					onChange={(v) => {
						if (v) {
							navigate(
								$path("/media/:action/:lot", {
									action: v,
									lot: lot.toLowerCase(),
								}),
							);
							if (v === "search") advanceOnboardingTourStep();
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
						<CreateButton
							to={$path(
								"/media/item/update/:action",
								{ action: "create" },
								{ lot },
							)}
						/>
					</Tabs.List>
				</Tabs>

				<Stack>
					{action === "list" ? (
						userMetadataList ? (
							<>
								<Group wrap="nowrap">
									<DebouncedSearchInput
										onChange={listState.updateQuery}
										value={listState.normalizedFilters.query}
										placeholder={`Sift through your ${changeCase(
											lot.toLowerCase(),
										).toLowerCase()}s`}
									/>
									<ActionIcon
										onClick={listModals.filtersModal.open}
										color={listState.areFiltersActive ? "blue" : "gray"}
									>
										<IconFilter size={24} />
									</ActionIcon>
									<FiltersModal
										resetFilters={listState.resetFilters}
										opened={listModals.filtersModal.opened}
										onSavePreset={listModals.presetModal.open}
										closeFiltersModal={listModals.filtersModal.close}
									>
										<FiltersModalForm
											lot={lot}
											filters={listState.normalizedFilters}
											onFiltersChange={listState.updateFilter}
										/>
									</FiltersModal>
								</Group>
								<FilterPresetBar presetManager={listPresets} />
								<DisplayListDetailsAndRefresh
									cacheId={userMetadataList.cacheId}
									onRefreshButtonClicked={refetchUserMetadataList}
									total={userMetadataList.response.details.totalItems}
									isRandomSortOrderSelected={
										listState.normalizedFilters.sortBy === MediaSortBy.Random
									}
								/>
								{(listState.normalizedFilters.startDateRange ||
									listState.normalizedFilters.endDateRange) &&
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
									value={listState.normalizedFilters.page}
									onChange={(v) => listState.updateFilter("page", v)}
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
								<Group wrap="nowrap">
									<DebouncedSearchInput
										value={searchState.normalizedFilters.query}
										placeholder={`Search for ${changeCase(
											lot.toLowerCase(),
										).toLowerCase()}s`}
										onChange={(value) => {
											searchState.updateFilter("query", value);
											searchState.updateFilter("page", 1);
										}}
										tourControl={{
											target: OnboardingTourStepTargets.SearchAudiobook,
											onQueryChange: (query) => {
												if (query === TOUR_METADATA_TARGET_ID)
													advanceOnboardingTourStep({ increaseWaitBy: 2000 });
											},
										}}
									/>
									<Group gap="xs" wrap="nowrap">
										{(metadataLotSourceMapping?.sources.length || 0) > 1 ? (
											<Select
												value={searchState.normalizedFilters.source}
												onChange={(v) =>
													v &&
													searchState.updateFilter("source", v as MediaSource)
												}
												data={metadataLotSourceMapping?.sources.map((o) => ({
													value: o,
													label: startCase(o.toLowerCase()),
												}))}
											/>
										) : null}
										<ActionIcon
											onClick={searchModals.filtersModal.open}
											color={searchState.areFiltersActive ? "blue" : "gray"}
										>
											<IconFilter size={24} />
										</ActionIcon>
										<FiltersModal
											resetFilters={searchState.resetFilters}
											opened={searchModals.filtersModal.opened}
											onSavePreset={searchModals.presetModal.open}
											closeFiltersModal={searchModals.filtersModal.close}
										>
											<SearchFiltersModalForm
												filters={searchState.normalizedFilters}
												onFiltersChange={searchState.updateFilter}
											/>
										</FiltersModal>
									</Group>
								</Group>
								<FilterPresetBar presetManager={searchPresets} />
								{metadataSearch.response.details.totalItems > 0 ? (
									<>
										<DisplayListDetailsAndRefresh
											total={metadataSearch.response.details.totalItems}
										/>
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
									value={searchState.normalizedFilters.page}
									onChange={(v) => searchState.updateFilter("page", v)}
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

	const tourControlThree = props.isFirstItem
		? OnboardingTourStepTargets.GoToAudiobooksSectionAgain
		: undefined;

	return (
		<MetadataDisplayItem
			metadataId={props.item}
			isFirstItem={props.isFirstItem}
			shouldHighlightNameIfInteracted
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
				{filters.sortBy !== MediaSortBy.Random ? (
					<SortOrderToggle
						currentOrder={filters.sortOrder}
						onOrderChange={(order) => onFiltersChange("sortOrder", order)}
					/>
				) : null}
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
				<Text>No filters are available for {startCase(filters.source)}</Text>
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
			metadataId={props.item}
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
