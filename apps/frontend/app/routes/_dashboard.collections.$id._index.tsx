import {
	ActionIcon,
	Box,
	Button,
	Container,
	Divider,
	Flex,
	Group,
	MultiSelect,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CollectionContentsDocument,
	type CollectionContentsInput,
	CollectionContentsSortBy,
	CollectionRecommendationsDocument,
	type CollectionRecommendationsInput,
	EntityLot,
	type EntityWithLot,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	FilterPresetContextType,
	GraphqlSortOrder,
	MediaGeneralFilter,
	MediaLot,
	MediaSource,
	ReorderCollectionEntityDocument,
	type ReorderCollectionEntityInput,
} from "@ryot/generated/graphql/backend/graphql";
import { cloneDeep, isNumber, snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconBucketDroplet,
	IconEdit,
	IconFilter,
	IconMessageCircle2,
	IconStar,
	IconTrashFilled,
	IconUser,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	type inferParserType,
	parseAsArrayOf,
	parseAsInteger,
	parseAsString,
	parseAsStringEnum,
} from "nuqs";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import {
	ApplicationPagination,
	DisplayCollectionEntity,
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
import { ReviewItemDisplay } from "~/components/common/review";
import { MetadataDisplayItem } from "~/components/media/display-items";
import type { FilterUpdateFunction } from "~/lib/hooks/filters/types";
import { useFilterPresets } from "~/lib/hooks/filters/use-presets";
import { useFiltersState } from "~/lib/hooks/filters/use-state";
import { dayjsLib, getStartTimeFromRange } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useUserCollections,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { parseAsCollectionsFilter } from "~/lib/shared/validation";
import {
	useBulkEditCollection,
	useCreateOrUpdateCollectionModal,
} from "~/lib/state/collection";
import { useReviewEntity } from "~/lib/state/media";
import { ApplicationTimeRange } from "~/lib/types";

enum TabNames {
	Actions = "actions",
	Reviews = "reviews",
	Contents = "contents",
	Recommendations = "recommendations",
}

const DEFAULT_TAB = TabNames.Contents;

const defaultQueryState = {
	page: parseAsInteger.withDefault(1),
	query: parseAsString.withDefault(""),
	endDateRange: parseAsString.withDefault(""),
	startDateRange: parseAsString.withDefault(""),
	collections: parseAsCollectionsFilter.withDefault([]),
	entityLot: parseAsStringEnum(Object.values(EntityLot)),
	metadataLot: parseAsStringEnum(Object.values(MediaLot)),
	metadataSource: parseAsStringEnum(Object.values(MediaSource)),
	metadataGeneral: parseAsStringEnum(Object.values(MediaGeneralFilter)),
	orderBy: parseAsStringEnum(Object.values(GraphqlSortOrder)).withDefault(
		GraphqlSortOrder.Desc,
	),
	sortBy: parseAsStringEnum(
		Object.values(CollectionContentsSortBy),
	).withDefault(CollectionContentsSortBy.LastUpdatedOn),
	dateRange: parseAsStringEnum(Object.values(ApplicationTimeRange)).withDefault(
		ApplicationTimeRange.AllTime,
	),
	exerciseTypes: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseLot)),
	).withDefault([]),
	exerciseLevels: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseLevel)),
	).withDefault([]),
	exerciseForces: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseForce)),
	).withDefault([]),
	exerciseMuscles: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseMuscle)),
	).withDefault([]),
	exerciseMechanics: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseMechanic)),
	).withDefault([]),
	exerciseEquipments: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseEquipment)),
	).withDefault([]),
};

type FilterState = inferParserType<typeof defaultQueryState>;

export const meta = () => {
	return [{ title: "Collection Details | Ryot" }];
};

export default function Page(props: { params: { id: string } }) {
	const navigate = useNavigate();
	const userDetails = useUserDetails();
	const coreDetails = useCoreDetails();
	const { id: collectionId } = props.params;
	const userPreferences = useUserPreferences();
	const userCollections = useUserCollections();
	const [_r, setEntityToReview] = useReviewEntity();
	const bulkEditingCollection = useBulkEditCollection();
	const [isReorderMode, setIsReorderMode] = useState(false);
	const [tab, setTab] = useState<string | null>(DEFAULT_TAB);
	const { open: openCollectionModal } = useCreateOrUpdateCollectionModal();

	const { filters, resetFilters, updateFilters, haveFiltersChanged } =
		useFiltersState(defaultQueryState);

	const [
		presetModalOpened,
		{ open: openPresetModal, close: closePresetModal },
	] = useDisclosure(false);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	invariant(collectionId);

	const contentsPresets = useFilterPresets({
		filters,
		updateFilters,
		enabled: true,
		contextInformation: { collectionId },
		contextType: FilterPresetContextType.CollectionContents,
	});

	const queryInput: CollectionContentsInput = useMemo(
		() => ({
			collectionId,
			sort: { by: filters.sortBy, order: filters.orderBy },
			search: { page: filters.page, query: filters.query },
			filter: {
				entityLot: filters.entityLot,
				collections: filters.collections,
				dateRange: {
					endDate: filters.endDateRange || undefined,
					startDate: filters.startDateRange || undefined,
				},
				metadata:
					filters.metadataLot ||
					filters.metadataSource ||
					filters.metadataGeneral
						? {
								lot: filters.metadataLot,
								source: filters.metadataSource,
								general: filters.metadataGeneral,
							}
						: undefined,
				exercise:
					filters.exerciseTypes.length > 0 ||
					filters.exerciseLevels.length > 0 ||
					filters.exerciseForces.length > 0 ||
					filters.exerciseMuscles.length > 0 ||
					filters.exerciseMechanics.length > 0 ||
					filters.exerciseEquipments.length > 0
						? {
								types:
									filters.exerciseTypes.length > 0
										? filters.exerciseTypes
										: undefined,
								levels:
									filters.exerciseLevels.length > 0
										? filters.exerciseLevels
										: undefined,
								forces:
									filters.exerciseForces.length > 0
										? filters.exerciseForces
										: undefined,
								muscles:
									filters.exerciseMuscles.length > 0
										? filters.exerciseMuscles
										: undefined,
								mechanics:
									filters.exerciseMechanics.length > 0
										? filters.exerciseMechanics
										: undefined,
								equipments:
									filters.exerciseEquipments.length > 0
										? filters.exerciseEquipments
										: undefined,
							}
						: undefined,
			},
		}),
		[collectionId, filters],
	);

	const { data: collectionContents, refetch: refreshCollectionContents } =
		useQuery({
			queryKey:
				queryFactory.collections.collectionContents(queryInput).queryKey,
			queryFn: () =>
				clientGqlService
					.request(CollectionContentsDocument, { input: queryInput })
					.then((data) => data.collectionContents),
		});

	const details = collectionContents?.response;
	const colDetails = details && {
		id: collectionId,
		name: details.details.name,
		creatorUserId: details.user.id,
	};
	const thisCollection = userCollections.find((c) => c.id === collectionId);

	return (
		<>
			<FilterPresetModalManager
				opened={presetModalOpened}
				onClose={closePresetModal}
				presetManager={contentsPresets}
				placeholder="e.g., Favorite Collection View"
			/>
			<BulkCollectionEditingAffix
				bulkAddEntities={async () => {
					const input = cloneDeep(queryInput);
					input.search = { ...input.search, take: Number.MAX_SAFE_INTEGER };
					return await clientGqlService
						.request(CollectionContentsDocument, { input })
						.then((r) => r.collectionContents.response.results.items);
				}}
			/>
			<Container>
				<Stack>
					{details ? (
						<>
							<Group justify="space-between" align="flex-start">
								<Box>
									<Group gap="md">
										<Title>{details.details.name}</Title>
										{userDetails.id === details.user.id ? (
											<ActionIcon
												color="blue"
												variant="outline"
												onClick={() => {
													if (!thisCollection) return;
													openCollectionModal({
														collectionId: thisCollection.id,
													});
												}}
											>
												<IconEdit size={18} />
											</ActionIcon>
										) : null}
									</Group>
									<Text size="sm">
										Created by {details.user.name}{" "}
										{dayjsLib(details.details.createdOn).fromNow()}
									</Text>
								</Box>
							</Group>
							<Text>{details.details.description}</Text>
							<Tabs value={tab} onChange={setTab} keepMounted={false}>
								<Tabs.List mb="xs">
									<Tabs.Tab
										value={TabNames.Contents}
										leftSection={<IconBucketDroplet size={16} />}
									>
										Contents
									</Tabs.Tab>
									<Tabs.Tab
										value={TabNames.Recommendations}
										leftSection={<IconStar size={16} />}
									>
										Recommendations
									</Tabs.Tab>
									<Tabs.Tab
										value={TabNames.Actions}
										leftSection={<IconUser size={16} />}
									>
										Actions
									</Tabs.Tab>
									{!userPreferences.general.disableReviews ? (
										<Tabs.Tab
											value={TabNames.Reviews}
											leftSection={<IconMessageCircle2 size={16} />}
										>
											Reviews
										</Tabs.Tab>
									) : null}
								</Tabs.List>
								<Tabs.Panel value={TabNames.Contents}>
									<Stack>
										{!isReorderMode ? (
											<>
												<Group wrap="nowrap">
													<DebouncedSearchInput
														value={filters.query}
														placeholder="Search in the collection"
														onChange={(query) => updateFilters({ query })}
													/>
													<ActionIcon
														onClick={() => openFiltersModal()}
														color={haveFiltersChanged ? "blue" : "gray"}
													>
														<IconFilter size={24} />
													</ActionIcon>
													<FiltersModal
														opened={filtersModalOpened}
														resetFilters={resetFilters}
														onSavePreset={openPresetModal}
														closeFiltersModal={closeFiltersModal}
													>
														<FiltersModalForm
															filters={filters}
															updateFilter={(key, value) =>
																updateFilters({ [key]: value })
															}
														/>
													</FiltersModal>
												</Group>
												<FilterPresetBar presetManager={contentsPresets} />
												<DisplayListDetailsAndRefresh
													total={details.totalItems}
													cacheId={collectionContents?.cacheId}
													onRefreshButtonClicked={refreshCollectionContents}
													isRandomSortOrderSelected={
														filters.sortBy === CollectionContentsSortBy.Random
													}
												/>
											</>
										) : (
											<Group justify="end">
												<Button
													variant="outline"
													onClick={() => setIsReorderMode(false)}
												>
													Done Reordering
												</Button>
											</Group>
										)}
										{details.results.items.length > 0 ? (
											<ApplicationGrid>
												{details.results.items.map((lm, index) => (
													<CollectionItem
														item={lm}
														key={lm.entityId}
														rankNumber={index + 1}
														isReorderMode={isReorderMode}
														collectionName={details.details.name}
														totalItems={details.results.items.length}
													/>
												))}
											</ApplicationGrid>
										) : (
											<Text>
												You have not added anything to this collection
											</Text>
										)}
										<ApplicationPagination
											value={filters.page}
											totalItems={details.results.details.totalItems}
											onChange={(page) => updateFilters({ page })}
										/>
									</Stack>
								</Tabs.Panel>
								<Tabs.Panel value={TabNames.Recommendations}>
									<RecommendationsSection collectionId={collectionId} />
								</Tabs.Panel>
								<Tabs.Panel value={TabNames.Actions}>
									<SimpleGrid cols={{ base: 2, md: 3, lg: 4 }} spacing="lg">
										<Button
											w="100%"
											variant="outline"
											onClick={() => {
												setEntityToReview({
													entityId: collectionId,
													entityLot: EntityLot.Collection,
													entityTitle: details.details.name,
												});
											}}
										>
											Post a review
										</Button>
										<Button
											w="100%"
											variant="outline"
											onClick={() => {
												if (!colDetails) return;
												bulkEditingCollection.start(colDetails, "add");
												navigate(
													$path("/media/:action/:lot", {
														action: "list",
														lot: MediaLot.Movie.toLowerCase(),
													}),
												);
											}}
										>
											Bulk add
										</Button>
										<Button
											w="100%"
											variant="outline"
											disabled={details.results.details.totalItems === 0}
											onClick={() => {
												if (!colDetails) return;
												bulkEditingCollection.start(colDetails, "remove");
												setTab(TabNames.Contents);
											}}
										>
											Bulk remove
										</Button>
										<Button
											w="100%"
											variant="outline"
											disabled={details.results.details.totalItems === 0}
											onClick={() => {
												if (isReorderMode) {
													setIsReorderMode(false);
													return;
												}
												if (!coreDetails.isServerKeyValidated) {
													notifications.show({
														color: "red",
														title: "Pro Required",
														message:
															"Collection reordering requires a validated server key.",
													});
													return;
												}
												resetFilters();
												updateFilters({
													orderBy: GraphqlSortOrder.Asc,
													sortBy: CollectionContentsSortBy.Rank,
												});
												setTab(TabNames.Contents);
												setIsReorderMode(true);
											}}
										>
											{isReorderMode ? "Exit Reorder Mode" : "Reorder items"}
										</Button>
									</SimpleGrid>
								</Tabs.Panel>
								{!userPreferences.general.disableReviews ? (
									<Tabs.Panel value={TabNames.Reviews}>
										{details.reviews.length > 0 ? (
											<Stack>
												{details.reviews.map((r) => (
													<ReviewItemDisplay
														review={r}
														key={r.id}
														entityId={collectionId}
														title={details.details.name}
														entityLot={EntityLot.Collection}
													/>
												))}
											</Stack>
										) : (
											<Text>No reviews</Text>
										)}
									</Tabs.Panel>
								) : null}
							</Tabs>
						</>
					) : (
						<SkeletonLoader />
					)}
				</Stack>
			</Container>
		</>
	);
}

const FiltersModalForm = (props: {
	filters: FilterState;
	updateFilter: FilterUpdateFunction<FilterState>;
}) => {
	const coreDetails = useCoreDetails();

	return (
		<>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					value={props.filters.sortBy}
					onChange={(v) =>
						props.updateFilter("sortBy", v as CollectionContentsSortBy)
					}
					data={[
						{
							group: "Sort by",
							items: convertEnumToSelectData(CollectionContentsSortBy),
						},
					]}
				/>
				{props.filters.sortBy !== CollectionContentsSortBy.Random ? (
					<SortOrderToggle
						currentOrder={props.filters.orderBy}
						onOrderChange={(order) => props.updateFilter("orderBy", order)}
					/>
				) : null}
			</Flex>
			<Select
				clearable
				value={props.filters.entityLot}
				placeholder="Select an entity type"
				onChange={(v) => props.updateFilter("entityLot", v as EntityLot)}
				data={convertEnumToSelectData(
					Object.values(EntityLot).filter(
						(o) =>
							![
								EntityLot.Genre,
								EntityLot.Review,
								EntityLot.Collection,
								EntityLot.UserMeasurement,
							].includes(o),
					),
				)}
			/>
			{props.filters.entityLot === EntityLot.Metadata ||
			props.filters.entityLot === EntityLot.MetadataGroup ? (
				<>
					<Select
						clearable
						placeholder="Select a media type"
						value={props.filters.metadataLot}
						data={convertEnumToSelectData(MediaLot)}
						onChange={(v) => props.updateFilter("metadataLot", v as MediaLot)}
					/>
					{props.filters.entityLot === EntityLot.Metadata ? (
						<>
							<Select
								clearable
								placeholder="Select a media source"
								value={props.filters.metadataSource}
								data={convertEnumToSelectData(MediaSource)}
								onChange={(v) =>
									props.updateFilter("metadataSource", v as MediaSource)
								}
							/>
							<Select
								clearable
								placeholder="Select a general filter"
								value={props.filters.metadataGeneral}
								data={convertEnumToSelectData(MediaGeneralFilter)}
								onChange={(v) =>
									props.updateFilter("metadataGeneral", v as MediaGeneralFilter)
								}
							/>
						</>
					) : null}
				</>
			) : null}
			{props.filters.entityLot === EntityLot.Exercise ? (
				<Stack gap={2}>
					{[
						"exerciseTypes",
						"exerciseLevels",
						"exerciseForces",
						"exerciseMuscles",
						"exerciseMechanics",
						"exerciseEquipments",
					].map((f) => {
						const singularKey = f
							.replace("exercise", "")
							.replace("Types", "type")
							.replace("Levels", "level")
							.replace("Forces", "force")
							.replace("Muscles", "muscle")
							.replace("Mechanics", "mechanic")
							.replace("Equipments", "equipment")
							.toLowerCase();
						return (
							<MultiSelect
								key={f}
								size="xs"
								clearable
								searchable
								label={startCase(f.replace("exercise", ""))}
								value={(props.filters as any)[f]}
								onChange={(v) =>
									props.updateFilter(f as keyof FilterState, v as any)
								}
								data={(coreDetails.exerciseParameters.filters as any)[
									singularKey
								].map((v: any) => ({
									value: v,
									label: startCase(snakeCase(v)),
								}))}
							/>
						);
					})}
				</Stack>
			) : null}
			<Divider />
			<CollectionsFilter
				applied={props.filters.collections}
				onFiltersChanged={(val) => props.updateFilter("collections", val)}
			/>
			<Divider />
			<Stack gap="xs">
				<Select
					size="xs"
					value={props.filters.dateRange}
					description="Updated between time range"
					data={Object.values(ApplicationTimeRange)}
					onChange={(v) => {
						const range = v as ApplicationTimeRange;
						const startDateRange = getStartTimeFromRange(range);
						props.updateFilter("dateRange", range);
						if (range === ApplicationTimeRange.Custom) return;

						props.updateFilter(
							"startDateRange",
							startDateRange?.format("YYYY-MM-DD") || "",
						);
						props.updateFilter(
							"endDateRange",
							range === ApplicationTimeRange.AllTime
								? ""
								: dayjsLib().format("YYYY-MM-DD"),
						);
					}}
				/>
				{props.filters.dateRange === ApplicationTimeRange.Custom ? (
					<DatePickerInput
						size="xs"
						type="range"
						description="Select custom dates"
						value={
							props.filters.startDateRange && props.filters.endDateRange
								? [
										new Date(props.filters.startDateRange),
										new Date(props.filters.endDateRange),
									]
								: undefined
						}
						onChange={(v) => {
							const start = v[0];
							const end = v[1];
							if (!start || !end) return;
							props.updateFilter(
								"startDateRange",
								dayjsLib(start).format("YYYY-MM-DD"),
							);
							props.updateFilter(
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

const defaultRecommendationsState = {
	recommendationsPage: parseAsInteger.withDefault(1),
	recommendationsQuery: parseAsString.withDefault(""),
};

const RecommendationsSection = (props: { collectionId: string }) => {
	const { filters: search, updateFilters } = useFiltersState(
		defaultRecommendationsState,
	);

	const input: CollectionRecommendationsInput = {
		collectionId: props.collectionId,
		search: {
			page: search.recommendationsPage,
			query: search.recommendationsQuery,
		},
	};

	const { data: recommendations } = useQuery({
		queryKey:
			queryFactory.collections.collectionRecommendations(input).queryKey,
		queryFn: () =>
			clientGqlService.request(CollectionRecommendationsDocument, { input }),
	});

	return (
		<Stack gap="xs">
			<DebouncedSearchInput
				value={search.recommendationsQuery}
				placeholder="Search recommendations"
				onChange={(query) => updateFilters({ recommendationsQuery: query })}
			/>
			{recommendations ? (
				recommendations.collectionRecommendations.details.totalItems > 0 ? (
					<>
						<ApplicationGrid>
							{recommendations.collectionRecommendations.items.map((r) => (
								<MetadataDisplayItem
									key={r}
									metadataId={r}
									shouldHighlightNameIfInteracted
								/>
							))}
						</ApplicationGrid>
						<ApplicationPagination
							value={search.recommendationsPage}
							onChange={(page) => updateFilters({ recommendationsPage: page })}
							totalItems={
								recommendations.collectionRecommendations.details.totalItems
							}
						/>
					</>
				) : (
					<Text>No recommendations found</Text>
				)
			) : (
				<SkeletonLoader />
			)}
		</Stack>
	);
};

type CollectionItemProps = {
	rankNumber: number;
	totalItems: number;
	item: EntityWithLot;
	collectionName: string;
	isReorderMode: boolean;
};

const CollectionItem = (props: CollectionItemProps) => {
	const bulkEditingCollection = useBulkEditCollection();
	const state = bulkEditingCollection.state;
	const isAdded = bulkEditingCollection.isAdded(props.item);

	const reorderMutation = useMutation({
		mutationFn: (input: ReorderCollectionEntityInput) =>
			clientGqlService.request(ReorderCollectionEntityDocument, { input }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryFactory.collections.collectionContents._def,
			});
		},
		onError: (_error) => {
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to reorder item. Please try again.",
			});
		},
	});

	const handleRankClick = () => {
		if (!props.isReorderMode) return;

		const newRank = prompt(
			`Enter new rank for this item (1-${props.totalItems}):`,
		);
		const rank = Number(newRank);
		if (newRank && isNumber(rank))
			if (rank >= 1 && rank <= props.totalItems)
				reorderMutation.mutate({
					newPosition: rank,
					entityId: props.item.entityId,
					collectionName: props.collectionName,
				});
	};

	return (
		<DisplayCollectionEntity
			entityId={props.item.entityId}
			entityLot={props.item.entityLot}
			centerElement={
				props.isReorderMode ? (
					<ActionIcon variant="filled" onClick={handleRankClick}>
						<Text size="xs" fw={700} c="white">
							{props.rankNumber}
						</Text>
					</ActionIcon>
				) : state && state.data.action === "remove" ? (
					<ActionIcon
						color="red"
						variant={isAdded ? "filled" : "transparent"}
						onClick={() => {
							if (isAdded) state.remove(props.item);
							else state.add(props.item);
						}}
					>
						<IconTrashFilled size={18} />
					</ActionIcon>
				) : null
			}
		/>
	);
};
