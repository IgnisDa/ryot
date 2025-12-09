import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Sparkline } from "@mantine/charts";
import {
	ActionIcon,
	Anchor,
	Box,
	Container,
	Divider,
	Flex,
	Group,
	Select,
	Skeleton,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure, useInViewport } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	EntityLot,
	FilterPresetContextType,
	GraphqlSortOrder,
	type UserTemplatesOrWorkoutsListInput,
	UserTemplatesOrWorkoutsListSortBy,
	UserWorkoutDetailsDocument,
	UserWorkoutTemplateDetailsDocument,
	UserWorkoutTemplatesListDocument,
	UserWorkoutsListDocument,
	type WorkoutSummary,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, humanizeDuration, truncate } from "@ryot/ts-utils";
import {
	IconCheck,
	IconChevronDown,
	IconChevronUp,
	IconClock,
	IconFilter,
	IconPlus,
	IconRoad,
	IconTrophy,
	IconWeight,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import {
	ApplicationPagination,
	DisplayListDetailsAndRefresh,
	SkeletonLoader,
} from "~/components/common";
import { BulkCollectionEditingAffix } from "~/components/common/bulk-collection-editing-affix";
import {
	FilterPresetBar,
	FilterPresetModalManager,
} from "~/components/common/filter-presets";
import {
	DebouncedSearchInput,
	FiltersModal,
	SortOrderToggle,
} from "~/components/common/filters";
import { WorkoutRevisionScheduledAlert } from "~/components/fitness/display-items";
import {
	displayDistanceWithUnit,
	displayWeightWithUnit,
	getSetStatisticsTextToDisplay,
} from "~/components/fitness/utils";
import { useFilterPresets } from "~/lib/hooks/filters/use-presets";
import { useFilterState } from "~/lib/hooks/filters/use-state";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useExerciseDetails,
	useGetWorkoutStarter,
	useUserUnitSystem,
} from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { useBulkEditCollection } from "~/lib/state/collection";
import { getDefaultWorkout } from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import {
	type FilterUpdateFunction,
	FitnessAction,
	FitnessEntity,
} from "~/lib/types";

interface FilterState {
	page: number;
	query: string;
	orderBy: GraphqlSortOrder;
	sortBy: UserTemplatesOrWorkoutsListSortBy;
}

const defaultFilterState: FilterState = {
	page: 1,
	query: "",
	orderBy: GraphqlSortOrder.Desc,
	sortBy: UserTemplatesOrWorkoutsListSortBy.Time,
};

export const meta = () => {
	return [{ title: "Fitness Entity List | Ryot" }];
};

const useBulkEditingState = () => {
	const bulkEditingCollection = useBulkEditCollection();
	return bulkEditingCollection.state === false
		? null
		: bulkEditingCollection.state;
};

const buildQueryInput = (
	filters: FilterState,
	overrides?: Partial<UserTemplatesOrWorkoutsListInput>,
): UserTemplatesOrWorkoutsListInput => {
	const baseInput: UserTemplatesOrWorkoutsListInput = {
		sort: { by: filters.sortBy, order: filters.orderBy },
		search: { query: filters.query, page: filters.page },
	};

	if (overrides) {
		return {
			...baseInput,
			...overrides,
			search: {
				...baseInput.search,
				...overrides.search,
			},
		};
	}

	return baseInput;
};

export default function Page(props: { params: { entity: FitnessEntity } }) {
	const { entity } = props.params;
	invariant(entity);

	const filterState = useFilterState({
		defaultFilters: defaultFilterState,
		storageKey: `Fitness-${entity}-ListFilters`,
	});
	const coreDetails = useCoreDetails();
	const startWorkout = useGetWorkoutStarter();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [
		presetModalOpened,
		{ open: openPresetModal, close: closePresetModal },
	] = useDisclosure(false);
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const bulkEditingState = useBulkEditingState();

	const input = buildQueryInput(filterState.normalizedFilters);

	const listPresets = useFilterPresets({
		enabled: true,
		contextInformation: { entity },
		filters: filterState.normalizedFilters,
		setFilters: filterState.setFiltersState,
		contextType: FilterPresetContextType.FitnessEntitiesList,
		storageKeyPrefix: `FitnessEntityListActivePreset_${entity}`,
	});

	const { data: listData, refetch: refetchListData } = useQuery({
		queryKey: queryFactory.fitness.entityList(entity, input).queryKey,
		queryFn: () =>
			match(entity)
				.with(FitnessEntity.Workouts, () =>
					clientGqlService
						.request(UserWorkoutsListDocument, { input })
						.then(({ userWorkoutsList }) => ({
							cacheId: userWorkoutsList.cacheId,
							items: userWorkoutsList.response.items,
							details: userWorkoutsList.response.details,
						})),
				)
				.with(FitnessEntity.Templates, () =>
					clientGqlService
						.request(UserWorkoutTemplatesListDocument, { input })
						.then(({ userWorkoutTemplatesList }) => ({
							cacheId: userWorkoutTemplatesList.cacheId,
							items: userWorkoutTemplatesList.response.items,
							details: userWorkoutTemplatesList.response.details,
						})),
				)
				.exhaustive(),
	});

	const areListFiltersActive = filterState.areFiltersActive;

	return (
		<>
			<FilterPresetModalManager
				opened={presetModalOpened}
				onClose={closePresetModal}
				presetManager={listPresets}
				placeholder="e.g., Quick HIIT Sessions"
			/>
			<BulkCollectionEditingAffix
				bulkAddEntities={async () => {
					if (bulkEditingState?.data.action !== "add") return [];

					const queryInput = buildQueryInput(filterState.normalizedFilters, {
						search: { page: 1, take: Number.MAX_SAFE_INTEGER },
					});

					if (entity === FitnessEntity.Workouts) {
						const { userWorkoutsList } = await clientGqlService.request(
							UserWorkoutsListDocument,
							{ input: queryInput },
						);
						return userWorkoutsList.response.items.map((workoutId) => ({
							entityId: workoutId,
							entityLot: EntityLot.Workout,
						}));
					}

					const { userWorkoutTemplatesList } = await clientGqlService.request(
						UserWorkoutTemplatesListDocument,
						{ input: queryInput },
					);
					return userWorkoutTemplatesList.response.items.map((templateId) => ({
						entityId: templateId,
						entityLot: EntityLot.WorkoutTemplate,
					}));
				}}
			/>
			<Container size="xs">
				<Stack>
					<WorkoutRevisionScheduledAlert />
					<Flex align="center" gap="md">
						<Title>{changeCase(entity)}</Title>
						<ActionIcon
							color="green"
							variant="outline"
							className={OnboardingTourStepTargets.AddNewWorkout}
							onClick={async () => {
								if (
									!coreDetails.isServerKeyValidated &&
									entity === FitnessEntity.Templates
								) {
									notifications.show({
										color: "red",
										message: PRO_REQUIRED_MESSAGE,
									});
									return;
								}
								const action = match(entity)
									.with(FitnessEntity.Workouts, () => FitnessAction.LogWorkout)
									.with(
										FitnessEntity.Templates,
										() => FitnessAction.CreateTemplate,
									)
									.exhaustive();
								advanceOnboardingTourStep();
								startWorkout(getDefaultWorkout(action), action);
							}}
						>
							<IconPlus size={16} />
						</ActionIcon>
					</Flex>
					<Group wrap="nowrap">
						<DebouncedSearchInput
							onChange={filterState.updateQuery}
							placeholder={`Search for ${entity}`}
							value={filterState.normalizedFilters.query}
						/>
						<ActionIcon
							onClick={openFiltersModal}
							color={areListFiltersActive ? "blue" : "gray"}
						>
							<IconFilter size={24} />
						</ActionIcon>
						<FiltersModal
							opened={filtersModalOpened}
							onSavePreset={openPresetModal}
							closeFiltersModal={closeFiltersModal}
							resetFilters={filterState.resetFilters}
						>
							<FiltersModalForm
								filters={filterState.normalizedFilters}
								updateFilter={filterState.updateFilter}
							/>
						</FiltersModal>
					</Group>
					<FilterPresetBar presetManager={listPresets} />
					<Stack gap="xs">
						{listData ? (
							<>
								<DisplayListDetailsAndRefresh
									cacheId={listData.cacheId}
									total={listData.details.totalItems}
									onRefreshButtonClicked={refetchListData}
									isRandomSortOrderSelected={
										filterState.normalizedFilters.sortBy ===
										UserTemplatesOrWorkoutsListSortBy.Random
									}
								/>
								{listData.items.length > 0 ? (
									listData.items.map((entityId, index) => (
										<DisplayFitnessEntity
											index={index}
											key={entityId}
											entity={entity}
											entityId={entityId}
										/>
									))
								) : (
									<Text>No {entity} found</Text>
								)}
								<ApplicationPagination
									totalItems={listData.details.totalItems}
									value={filterState.normalizedFilters.page}
									onChange={(v) => filterState.updateFilter("page", v)}
								/>
							</>
						) : (
							<SkeletonLoader />
						)}
					</Stack>
				</Stack>
			</Container>
		</>
	);
}

const DisplayFitnessEntity = (props: {
	index: number;
	entityId: string;
	entity: FitnessEntity;
}) => {
	const unitSystem = useUserUnitSystem();
	const { ref, inViewport } = useInViewport();
	const [parent] = useAutoAnimate();
	const [showDetails, setShowDetails] = useDisclosure(false);
	const bulkEditingCollection = useBulkEditCollection();
	const bulkEditingState = useBulkEditingState();
	const entityLot =
		props.entity === FitnessEntity.Workouts
			? EntityLot.Workout
			: EntityLot.WorkoutTemplate;
	const becItem = { entityId: props.entityId, entityLot };
	const isAlreadyPresent = bulkEditingCollection.isAlreadyPresent(becItem);
	const isAdded = bulkEditingCollection.isAdded(becItem);

	const { data: entityInformation } = useQuery({
		enabled: inViewport,
		queryKey: ["fitnessEntityDetails", props.entityId],
		queryFn: () =>
			match(props.entity)
				.with(FitnessEntity.Workouts, () =>
					clientGqlService
						.request(UserWorkoutDetailsDocument, { workoutId: props.entityId })
						.then(({ userWorkoutDetails: { response } }) => ({
							name: response.details.name,
							summary: response.details.summary,
							timestamp: response.details.startTime,
							information: response.details.information,
							detail: humanizeDuration(
								dayjsLib
									.duration(response.details.duration, "second")
									.asMilliseconds(),
								{ round: true, units: ["h", "m"] },
							),
						})),
				)
				.with(FitnessEntity.Templates, () =>
					clientGqlService
						.request(UserWorkoutTemplateDetailsDocument, {
							workoutTemplateId: props.entityId,
						})
						.then(({ userWorkoutTemplateDetails: { response } }) => ({
							name: response.details.name,
							summary: response.details.summary,
							timestamp: response.details.createdOn,
							information: response.details.information,
							detail: `${response.details.information.exercises.length} exercises`,
						})),
				)
				.exhaustive(),
	});

	if (!entityInformation)
		return (
			<Stack gap={4} ref={ref}>
				<Skeleton height={76} />
				<Group wrap="nowrap" justify="space-between" gap={4}>
					<Skeleton height={40} />
					<Skeleton height={40} />
				</Group>
			</Stack>
		);

	const personalBestsAchieved =
		entityInformation.summary.total?.personalBestsAchieved || 0;
	const repsData = (entityInformation.information.exercises || [])
		.map((e) => Number.parseInt(e.total?.reps || "0"))
		.filter(Boolean);

	return (
		<>
			{props.index !== 0 ? <Divider /> : null}
			<Stack gap="xs" ref={parent} px={{ base: 4 }}>
				<Group wrap="nowrap" justify="space-between">
					<Box>
						<Group wrap="nowrap">
							<Anchor
								component={Link}
								fz={{ base: "sm", md: "md" }}
								to={$path("/fitness/:entity/:id", {
									id: props.entityId,
									entity: props.entity,
								})}
							>
								{truncate(entityInformation.name, { length: 20 })}
							</Anchor>
							<Text fz={{ base: "xs", md: "sm" }} c="dimmed">
								{dayjsLib(entityInformation.timestamp).format("dddd, LL")}
							</Text>
						</Group>
						<Group mt="xs">
							<DisplayStat
								data={entityInformation.detail}
								icon={match(props.entity)
									.with(FitnessEntity.Workouts, () => <IconClock size={16} />)
									.with(FitnessEntity.Templates, () => <IconWeight size={16} />)
									.exhaustive()}
							/>
							{entityInformation.summary.total ? (
								<>
									{personalBestsAchieved !== 0 ? (
										<DisplayStat
											icon={<IconTrophy size={16} />}
											data={`${personalBestsAchieved} PR${
												personalBestsAchieved > 1 ? "s" : ""
											}`}
										/>
									) : null}
									{Number(entityInformation.summary.total.weight) !== 0 ? (
										<DisplayStat
											icon={<IconWeight size={16} />}
											data={displayWeightWithUnit(
												unitSystem,
												entityInformation.summary.total.weight,
											)}
										/>
									) : null}
									{Number(entityInformation.summary.total.distance) !== 0 ? (
										<Box visibleFrom="md">
											<DisplayStat
												icon={<IconRoad size={16} />}
												data={displayDistanceWithUnit(
													unitSystem,
													entityInformation.summary.total.distance,
												)}
											/>
										</Box>
									) : null}
								</>
							) : null}
						</Group>
					</Box>
					<Group wrap="nowrap" gap="xs">
						{bulkEditingState &&
						bulkEditingState.data.action === "add" &&
						!isAlreadyPresent ? (
							<ActionIcon
								color="green"
								variant={isAdded ? "filled" : "outline"}
								disabled={bulkEditingState.data.isLoading}
								onClick={() => {
									if (isAdded) bulkEditingState.remove(becItem);
									else bulkEditingState.add(becItem);
								}}
							>
								<IconCheck size={16} />
							</ActionIcon>
						) : null}
						<ActionIcon onClick={() => setShowDetails.toggle()}>
							{showDetails ? (
								<IconChevronUp size={16} />
							) : (
								<IconChevronDown size={16} />
							)}
						</ActionIcon>
					</Group>
				</Group>
				{repsData.length >= 3 ? (
					<Sparkline h="60" data={repsData} color="teal" />
				) : null}
				{showDetails ? (
					<Box px={{ base: "xs", md: "md" }}>
						<Group justify="space-between">
							<Text fw="bold">Exercise</Text>
							{props.entity === FitnessEntity.Workouts ? (
								<Text fw="bold">Best set</Text>
							) : null}
						</Group>
						{entityInformation.summary.exercises.map((exercise, idx) => (
							<ExerciseDisplay
								exercise={exercise}
								key={`${idx}-${exercise.id}`}
							/>
						))}
					</Box>
				) : null}
			</Stack>
		</>
	);
};

const DisplayStat = (props: { icon: ReactElement; data: string }) => {
	return (
		<Flex gap={4} align="center">
			{props.icon}
			<Text fz={{ base: "xs", md: "sm" }} span>
				{props.data}
			</Text>
		</Flex>
	);
};

const ExerciseDisplay = (props: {
	exercise: WorkoutSummary["exercises"][number];
}) => {
	const { data: exerciseDetails } = useExerciseDetails(props.exercise.id);
	const stat = match(props.exercise.bestSet)
		.with(undefined, null, () => {})
		.otherwise((value) => {
			invariant(props.exercise.lot);
			const [stat] = getSetStatisticsTextToDisplay(
				props.exercise.lot,
				value.statistic,
				props.exercise.unitSystem,
			);
			return stat;
		});

	return (
		<Flex gap="xs">
			<Text fz="sm" ff="monospace">
				{props.exercise.numSets} ×
			</Text>
			<Text flex={1} fz="sm">
				{exerciseDetails?.name}
			</Text>
			{stat ? <Text fz="sm">{stat}</Text> : null}
		</Flex>
	);
};

const FiltersModalForm = (props: {
	filters: FilterState;
	updateFilter: FilterUpdateFunction<FilterState>;
}) => {
	return (
		<Flex gap="xs" align="center">
			<Select
				w="100%"
				value={props.filters.sortBy}
				data={convertEnumToSelectData(UserTemplatesOrWorkoutsListSortBy)}
				onChange={(v) => {
					if (v) {
						props.updateFilter(
							"sortBy",
							v as UserTemplatesOrWorkoutsListSortBy,
						);
					}
				}}
			/>
			{props.filters.sortBy !== UserTemplatesOrWorkoutsListSortBy.Random ? (
				<SortOrderToggle
					currentOrder={props.filters.orderBy}
					onOrderChange={(order) => props.updateFilter("orderBy", order)}
				/>
			) : null}
		</Flex>
	);
};
