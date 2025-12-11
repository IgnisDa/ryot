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
import {
	type inferParserType,
	parseAsArrayOf,
	parseAsBoolean,
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
import { useFiltersState } from "~/lib/hooks/filters/use-state";
import { dayjsLib, getStartTimeFromRange } from "~/lib/shared/date-utils";
import { useCoreDetails, useUserMetadataList } from "~/lib/shared/hooks";
import { getLot } from "~/lib/shared/media-utils";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { parseAsCollectionsFilter } from "~/lib/shared/validation";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	OnboardingTourStepTargets,
	TOUR_METADATA_TARGET_ID,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import { ApplicationTimeRange } from "~/lib/types";

const defaultListQueryState = {
	page: parseAsInteger.withDefault(1),
	query: parseAsString.withDefault(""),
	collections: parseAsCollectionsFilter.withDefault([]),
	endDateRange: parseAsString.withDefault(""),
	startDateRange: parseAsString.withDefault(""),
	sortBy: parseAsStringEnum(Object.values(MediaSortBy)).withDefault(
		MediaSortBy.LastUpdated,
	),
	generalFilter: parseAsStringEnum(
		Object.values(MediaGeneralFilter),
	).withDefault(MediaGeneralFilter.All),
	sortOrder: parseAsStringEnum(Object.values(GraphqlSortOrder)).withDefault(
		GraphqlSortOrder.Desc,
	),
	dateRange: parseAsStringEnum(Object.values(ApplicationTimeRange)).withDefault(
		ApplicationTimeRange.AllTime,
	),
};

const defaultSearchQueryState = {
	page: parseAsInteger.withDefault(1),
	query: parseAsString.withDefault(""),
	googleBooksPassRawQuery: parseAsBoolean.withDefault(false),
	igdbAllowGamesWithParent: parseAsBoolean.withDefault(false),
	igdbThemeIds: parseAsArrayOf(parseAsString).withDefault([]),
	igdbGenreIds: parseAsArrayOf(parseAsString).withDefault([]),
	igdbPlatformIds: parseAsArrayOf(parseAsString).withDefault([]),
	igdbGameModeIds: parseAsArrayOf(parseAsString).withDefault([]),
	igdbGameTypeIds: parseAsArrayOf(parseAsString).withDefault([]),
	igdbReleaseDateRegionIds: parseAsArrayOf(parseAsString).withDefault([]),
	source: parseAsStringEnum(Object.values(MediaSource)).withDefault(
		MediaSource.Tmdb,
	),
};

type ListFilterState = inferParserType<typeof defaultListQueryState>;
type SearchFilterState = inferParserType<typeof defaultSearchQueryState>;

export const meta = () => {
	return [{ title: "Media | Ryot" }];
};

export default function Page(props: {
	params: { action: string; lot: string };
}) {
	const navigate = useNavigate();
	const action = props.params.action;
	const coreDetails = useCoreDetails();
	const listModals = useFilterModals();
	const searchModals = useFilterModals();
	const lot = getLot(props.params.lot) as MediaLot;
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const metadataLotSourceMapping = coreDetails.metadataLotSourceMappings.find(
		(m) => m.lot === lot,
	);

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
		contextInformation: { lot },
		updateFilters: updateListFilters,
		contextType: FilterPresetContextType.MetadataList,
	});

	const searchPresets = useFilterPresets({
		filters: searchFilters,
		contextInformation: { lot },
		enabled: action === "search",
		updateFilters: updateSearchFilters,
		contextType: FilterPresetContextType.MetadataSearch,
	});

	const listInput: UserMetadataListInput = useMemo(
		() => ({
			lot,
			search: { page: listFilters.page, query: listFilters.query },
			sort: { by: listFilters.sortBy, order: listFilters.sortOrder },
			filter: {
				general: listFilters.generalFilter,
				collections: listFilters.collections,
				dateRange: {
					endDate: listFilters.endDateRange || undefined,
					startDate: listFilters.startDateRange || undefined,
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
				googleBooks: {
					passRawQuery: searchFilters.googleBooksPassRawQuery || undefined,
				},
				igdb: {
					filters: {
						themeIds:
							searchFilters.igdbThemeIds.length > 0
								? searchFilters.igdbThemeIds
								: undefined,
						genreIds:
							searchFilters.igdbGenreIds.length > 0
								? searchFilters.igdbGenreIds
								: undefined,
						platformIds:
							searchFilters.igdbPlatformIds.length > 0
								? searchFilters.igdbPlatformIds
								: undefined,
						gameModeIds:
							searchFilters.igdbGameModeIds.length > 0
								? searchFilters.igdbGameModeIds
								: undefined,
						gameTypeIds:
							searchFilters.igdbGameTypeIds.length > 0
								? searchFilters.igdbGameTypeIds
								: undefined,
						releaseDateRegionIds:
							searchFilters.igdbReleaseDateRegionIds.length > 0
								? searchFilters.igdbReleaseDateRegionIds
								: undefined,
						allowGamesWithParent:
							searchFilters.igdbAllowGamesWithParent || undefined,
					},
				},
			},
		}),
		[lot, searchFilters],
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
										value={listFilters.query}
										onChange={(value) => updateListFilters({ query: value })}
										placeholder={`Sift through your ${changeCase(
											lot.toLowerCase(),
										).toLowerCase()}s`}
									/>
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
											lot={lot}
											filters={listFilters}
											onFiltersChange={(key, value) =>
												updateListFilters({ [key]: value })
											}
										/>
									</FiltersModal>
								</Group>
								<FilterPresetBar presetManager={listPresets} />
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
									onChange={(page) => updateListFilters({ page })}
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
										value={searchFilters.query}
										onChange={(value) => updateSearchFilters({ query: value })}
										placeholder={`Search for ${changeCase(
											lot.toLowerCase(),
										).toLowerCase()}s`}
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
												value={searchFilters.source}
												onChange={(v) =>
													v && updateSearchFilters({ source: v as MediaSource })
												}
												data={metadataLotSourceMapping?.sources.map((o) => ({
													value: o,
													label: startCase(o.toLowerCase()),
												}))}
											/>
										) : null}
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
									value={searchFilters.page}
									onChange={(page) => updateSearchFilters({ page })}
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

	return (
		<Stack gap="xs">
			{filters.source === MediaSource.GoogleBooks ? (
				<Checkbox
					label="Pass raw query"
					checked={filters.googleBooksPassRawQuery}
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
						onChange={(key, value) =>
							onFiltersChange(key as keyof SearchFilterState, value || [])
						}
					/>
					<IgdbMultiselect
						label="Select genres"
						valueKey="igdbGenreIds"
						value={filters.igdbGenreIds}
						data={coreDetails.providerSpecifics.igdb.genres}
						onChange={(key, value) =>
							onFiltersChange(key as keyof SearchFilterState, value || [])
						}
					/>
					<IgdbMultiselect
						label="Select platforms"
						valueKey="igdbPlatformIds"
						value={filters.igdbPlatformIds}
						data={coreDetails.providerSpecifics.igdb.platforms}
						onChange={(key, value) =>
							onFiltersChange(key as keyof SearchFilterState, value || [])
						}
					/>
					<IgdbMultiselect
						label="Select game types"
						valueKey="igdbGameTypeIds"
						value={filters.igdbGameTypeIds}
						data={coreDetails.providerSpecifics.igdb.gameTypes}
						onChange={(key, value) =>
							onFiltersChange(key as keyof SearchFilterState, value || [])
						}
					/>
					<IgdbMultiselect
						label="Select game modes"
						valueKey="igdbGameModeIds"
						value={filters.igdbGameModeIds}
						data={coreDetails.providerSpecifics.igdb.gameModes}
						onChange={(key, value) =>
							onFiltersChange(key as keyof SearchFilterState, value || [])
						}
					/>
					<IgdbMultiselect
						label="Select release regions"
						valueKey="igdbReleaseDateRegionIds"
						value={filters.igdbReleaseDateRegionIds}
						data={coreDetails.providerSpecifics.igdb.releaseDateRegions}
						onChange={(key, value) =>
							onFiltersChange(key as keyof SearchFilterState, value || [])
						}
					/>
					<Checkbox
						label="Allow games with parent"
						checked={filters.igdbAllowGamesWithParent}
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
