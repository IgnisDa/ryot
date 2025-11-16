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
	Modal,
	MultiSelect,
	Select,
	Stack,
	Tabs,
	Text,
	TextInput,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDisclosure, useLongPress } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
	CreateFilterPresetDocument,
	DeleteFilterPresetDocument,
	EntityLot,
	FilterPresetContextType,
	FilterPresetsDocument,
	GraphqlSortOrder,
	type MediaCollectionFilter,
	MediaGeneralFilter,
	MediaLot,
	MediaSortBy,
	MediaSource,
	MetadataSearchDocument,
	type MetadataSearchInput,
	type MetadataSearchQuery,
	UpdateFilterPresetLastUsedDocument,
	UserMetadataListDocument,
	type UserMetadataListInput,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, cloneDeep, isEqual, startCase } from "@ryot/ts-utils";
import {
	IconCheck,
	IconFilter,
	IconListCheck,
	IconSearch,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import { useLocalStorage } from "usehooks-ts";
import {
	ApplicationPagination,
	CreateButton,
	DisplayListDetailsAndRefresh,
	ProRequiredAlert,
	SkeletonLoader,
} from "~/components/common";
import { BulkCollectionEditingAffix } from "~/components/common/BulkCollectionEditingAffix";
import {
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
	SortOrderToggle,
} from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { dayjsLib, getStartTimeFromRange } from "~/lib/shared/date-utils";
import { useCoreDetails, useUserMetadataList } from "~/lib/shared/hooks";
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
	const navigate = useNavigate();
	const [parent] = useAutoAnimate();
	const action = props.params.action;
	const coreDetails = useCoreDetails();
	const lot = getLot(props.params.lot) as MediaLot;
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const metadataLotSourceMapping = coreDetails.metadataLotSourceMappings.find(
		(m) => m.lot === lot,
	);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [
		searchFiltersModalOpened,
		{ open: openSearchFiltersModal, close: closeSearchFiltersModal },
	] = useDisclosure(false);
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
	const [activePresetId, setActivePresetId] = useLocalStorage<string | null>(
		`MediaActivePreset_${lot}`,
		null,
	);
	const isApplyingPreset = useRef(false);
	const [
		createPresetModalOpened,
		{ open: openCreatePresetModal, close: closeCreatePresetModal },
	] = useDisclosure(false);

	const { data: filterPresets, refetch: refetchFilterPresets } = useQuery({
		enabled: action === "list",
		queryKey: ["filterPresets", lot],
		queryFn: () =>
			clientGqlService
				.request(FilterPresetsDocument, {
					input: {
						contextInformation: { metadataList: { lot } },
						contextType: FilterPresetContextType.MediaList,
					},
				})
				.then((data) => data.filterPresets),
	});

	const createPresetMutation = useMutation({
		mutationFn: (variables: {
			input: { name: string; filters: unknown; id?: string };
		}) =>
			clientGqlService.request(CreateFilterPresetDocument, {
				input: {
					...variables.input,
					contextInformation: { metadataList: { lot } },
					contextType: FilterPresetContextType.MediaList,
				},
			}),
		onSuccess: () => {
			refetchFilterPresets();
			notifications.show({
				color: "green",
				title: "Success",
				message: "Filter preset saved",
			});
		},
	});

	const deletePresetMutation = useMutation({
		mutationFn: (filterPresetId: string) =>
			clientGqlService.request(DeleteFilterPresetDocument, {
				filterPresetId,
			}),
		onSuccess: () => {
			refetchFilterPresets();
			setActivePresetId(null);
			notifications.show({
				color: "green",
				title: "Success",
				message: "Filter preset deleted",
			});
		},
	});

	const updateLastUsedMutation = useMutation({
		onSuccess: () => refetchFilterPresets(),
		mutationFn: (filterPresetId: string) =>
			clientGqlService.request(UpdateFilterPresetLastUsedDocument, {
				filterPresetId,
			}),
	});

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

	const areListFiltersActive = isFilterChanged(listFilters, defaultListFilters);

	const updateListFilters: FilterUpdateFunction<ListFilterState> = (
		key,
		value,
	) => setListFilters((prev) => ({ ...prev, [key]: value }));

	const updateSearchFilters: FilterUpdateFunction<SearchFilterState> = (
		key,
		value,
	) => setSearchFilters((prev) => ({ ...prev, [key]: value }));

	const applyPreset = async (presetId: string, filters: unknown) => {
		isApplyingPreset.current = true;
		const parsedFilters =
			typeof filters === "string" ? JSON.parse(filters) : filters;
		setListFilters({ ...parsedFilters, page: 1 });
		setActivePresetId(presetId);
		setTimeout(() => {
			isApplyingPreset.current = false;
		}, 100);
		updateLastUsedMutation.mutate(presetId);
	};

	const handleSavePreset = async (name: string) => {
		const filtersToSave = { ...listFilters, page: 1 };
		await createPresetMutation.mutateAsync({
			input: { name, filters: filtersToSave },
		});
		closeCreatePresetModal();
	};

	const handleDeletePreset = (presetId: string, presetName: string) => {
		modals.openConfirmModal({
			title: "Delete preset",
			confirmProps: { color: "red" },
			labels: { confirm: "Delete", cancel: "Cancel" },
			onConfirm: () => deletePresetMutation.mutate(presetId),
			children: (
				<Text>Are you sure you want to delete the preset "{presetName}"?</Text>
			),
		});
	};

	useEffect(() => {
		if (isApplyingPreset.current) return;

		if (!activePresetId || !filterPresets) return;

		const activePreset = filterPresets.response.find(
			(p) => p.id === activePresetId,
		);
		if (!activePreset) return;

		const savedFilters =
			typeof activePreset.filters === "string"
				? JSON.parse(activePreset.filters)
				: activePreset.filters;

		const { page: _currentPage, ...filtersWithoutPage } = listFilters;
		const { page: _savedPage, ...savedWithoutPage } = savedFilters;

		if (!isEqual(filtersWithoutPage, savedWithoutPage)) setActivePresetId(null);
	}, [listFilters, activePresetId, filterPresets]);

	const isEligibleForNextTourStep = lot === MediaLot.AudioBook;

	return (
		<>
			<CreatePresetModal
				onSave={handleSavePreset}
				currentFilters={listFilters}
				opened={createPresetModalOpened}
				onClose={closeCreatePresetModal}
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
										<Divider my="sm" />
										<Button
											fullWidth
											variant="light"
											onClick={() => {
												closeFiltersModal();
												openCreatePresetModal();
											}}
										>
											Save current filters as preset
										</Button>
									</FiltersModal>
								</Group>
								{filterPresets && filterPresets.response.length > 0 ? (
									<Box>
										<Chip.Group
											key={activePresetId || "no-preset"}
											value={activePresetId || undefined}
											onChange={(value) => {
												if (!value) return;
												const preset = filterPresets.response.find(
													(p) => p.id === value,
												);
												if (preset) applyPreset(preset.id, preset.filters);
											}}
										>
											<Group
												gap="xs"
												ref={parent}
												wrap="nowrap"
												style={{ overflowX: "auto" }}
											>
												{filterPresets.response.map((preset) => (
													<PresetChip
														id={preset.id}
														key={preset.id}
														name={preset.name}
														onDelete={handleDeletePreset}
													/>
												))}
											</Group>
										</Chip.Group>
									</Box>
								) : null}
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
								<Group wrap="nowrap">
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
												if (query === TOUR_METADATA_TARGET_ID.toLowerCase())
													advanceOnboardingTourStep({ increaseWaitBy: 2000 });
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
								</Group>
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

const CreatePresetModal = (props: {
	opened: boolean;
	onClose: () => void;
	onSave: (name: string) => void;
	currentFilters: ListFilterState;
}) => {
	const [presetName, setPresetName] = useState("");

	const getFilterSummary = () => {
		const summary: string[] = [];

		if (props.currentFilters.generalFilter !== MediaGeneralFilter.All)
			summary.push(
				`General: ${startCase(props.currentFilters.generalFilter.toLowerCase())}`,
			);

		if (props.currentFilters.sortBy !== MediaSortBy.LastUpdated)
			summary.push(
				`Sort: ${startCase(props.currentFilters.sortBy.toLowerCase())} (${props.currentFilters.sortOrder})`,
			);

		if (props.currentFilters.collections.length > 0)
			summary.push(
				`Collections: ${props.currentFilters.collections.length} selected`,
			);

		if (props.currentFilters.dateRange !== ApplicationTimeRange.AllTime)
			summary.push(`Date Range: ${props.currentFilters.dateRange}`);

		if (props.currentFilters.query)
			summary.push(`Search: "${props.currentFilters.query}"`);

		return summary;
	};

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			title="Save Filter Preset"
		>
			<Stack>
				<TextInput
					data-autofocus
					value={presetName}
					label="Preset Name"
					placeholder="e.g., Unfinished Books"
					onChange={(e) => setPresetName(e.currentTarget.value)}
				/>

				<Box>
					<Text size="sm" fw={500} mb="xs">
						This will save:
					</Text>
					{getFilterSummary().length > 0 ? (
						<Stack gap="xs">
							{getFilterSummary().map((item) => (
								<Text key={item} size="sm" c="dimmed">
									• {item}
								</Text>
							))}
						</Stack>
					) : (
						<Text size="sm" c="dimmed">
							Default filters (no customization)
						</Text>
					)}
				</Box>

				<Group justify="flex-end" mt="md">
					<Button variant="default" onClick={props.onClose}>
						Cancel
					</Button>
					<Button
						disabled={!presetName.trim()}
						onClick={() => {
							if (presetName.trim()) {
								props.onSave(presetName.trim());
								setPresetName("");
							}
						}}
					>
						Save Preset
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
};

const PresetChip = (props: {
	id: string;
	name: string;
	onDelete: (id: string, name: string) => void;
}) => {
	const longPressHandlers = useLongPress(() =>
		props.onDelete(props.id, props.name),
	);
	return (
		<Chip size="sm" value={props.id} {...longPressHandlers}>
			{props.name}
		</Chip>
	);
};
