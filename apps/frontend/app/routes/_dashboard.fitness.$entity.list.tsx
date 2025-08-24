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
	IconChevronDown,
	IconChevronUp,
	IconClock,
	IconFilter,
	IconPlus,
	IconRoad,
	IconSortAscending,
	IconSortDescending,
	IconTrophy,
	IconWeight,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import {
	ApplicationPagination,
	DisplayListDetailsAndRefresh,
	SkeletonLoader,
} from "~/components/common";
import {
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import { WorkoutRevisionScheduledAlert } from "~/components/fitness/display-items";
import {
	displayDistanceWithUnit,
	displayWeightWithUnit,
	getSetStatisticsTextToDisplay,
} from "~/components/fitness/utils";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useGetWorkoutStarter,
	useUserUnitSystem,
} from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	isFilterChanged,
} from "~/lib/shared/ui-utils";
import {
	getDefaultWorkout,
	getExerciseDetailsQuery,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import {
	type FilterUpdateFunction,
	FitnessAction,
	FitnessEntity,
} from "~/lib/types";
import type { Route } from "./+types/_dashboard.fitness.$entity.list";

interface FilterState {
	query?: string;
	page: number;
	orderBy: GraphqlSortOrder;
	sortBy: UserTemplatesOrWorkoutsListSortBy;
}

const defaultFilterState: FilterState = {
	page: 1,
	query: undefined,
	orderBy: GraphqlSortOrder.Desc,
	sortBy: UserTemplatesOrWorkoutsListSortBy.Time,
};

export const meta = ({ params }: Route.MetaArgs) => {
	return [{ title: `${changeCase(params.entity || "")} | Ryot` }];
};

export default function Page(props: { entity: FitnessEntity }) {
	const { entity } = props;
	invariant(entity);

	const [filters, setFilters] = useLocalStorage(
		`Fitness-${entity}-ListFilters`,
		defaultFilterState,
	);
	const coreDetails = useCoreDetails();
	const startWorkout = useGetWorkoutStarter();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const updateFilter: FilterUpdateFunction<FilterState> = (key, value) =>
		setFilters((prev) => ({ ...prev, [key]: value }));

	const input: UserTemplatesOrWorkoutsListInput = {
		sort: { by: filters.sortBy, order: filters.orderBy },
		search: { query: filters.query, page: filters.page },
	};
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

	const totalPages = listData ? Math.ceil(listData.details.total / 10) : 1;

	const areListFiltersActive = isFilterChanged(filters, defaultFilterState);

	return (
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
						initialValue={filters.query}
						onChange={(value) => updateFilter("query", value)}
						placeholder={`Search for ${entity}`}
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
						resetFilters={() => setFilters(defaultFilterState)}
					>
						<FiltersModalForm filters={filters} updateFilter={updateFilter} />
					</FiltersModal>
				</Group>
				<Stack gap="xs">
					{listData ? (
						<>
							<DisplayListDetailsAndRefresh
								cacheId={listData.cacheId}
								total={listData.details.total}
								onRefreshButtonClicked={refetchListData}
								isRandomSortOrderSelected={
									filters.sortBy === UserTemplatesOrWorkoutsListSortBy.Random
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
						</>
					) : (
						<SkeletonLoader />
					)}
				</Stack>
				<ApplicationPagination
					total={totalPages}
					value={filters.page}
					onChange={(v) => updateFilter("page", v)}
				/>
			</Stack>
		</Container>
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

	const { data: entityInformation } = useQuery({
		enabled: inViewport,
		queryKey: ["fitnessEntityDetails", props.entityId],
		queryFn: () =>
			match(props.entity)
				.with(FitnessEntity.Workouts, () =>
					clientGqlService
						.request(UserWorkoutDetailsDocument, { workoutId: props.entityId })
						.then(({ userWorkoutDetails }) => ({
							name: userWorkoutDetails.details.name,
							summary: userWorkoutDetails.details.summary,
							timestamp: userWorkoutDetails.details.startTime,
							information: userWorkoutDetails.details.information,
							detail: humanizeDuration(
								dayjsLib
									.duration(userWorkoutDetails.details.duration, "second")
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
						.then(({ userWorkoutTemplateDetails }) => ({
							name: userWorkoutTemplateDetails.details.name,
							summary: userWorkoutTemplateDetails.details.summary,
							timestamp: userWorkoutTemplateDetails.details.createdOn,
							information: userWorkoutTemplateDetails.details.information,
							detail: `${userWorkoutTemplateDetails.details.information.exercises.length} exercises`,
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
					<ActionIcon onClick={() => setShowDetails.toggle()}>
						{showDetails ? (
							<IconChevronUp size={16} />
						) : (
							<IconChevronDown size={16} />
						)}
					</ActionIcon>
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
	const { data: exerciseDetails } = useQuery(
		getExerciseDetailsQuery(props.exercise.id),
	);
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
			<Text style={{ flex: 1 }} fz="sm">
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
				defaultValue={props.filters.sortBy}
				data={convertEnumToSelectData(UserTemplatesOrWorkoutsListSortBy)}
				onChange={(v) =>
					props.updateFilter("sortBy", v as UserTemplatesOrWorkoutsListSortBy)
				}
			/>
			<ActionIcon
				onClick={() => {
					if (props.filters.orderBy === GraphqlSortOrder.Asc)
						props.updateFilter("orderBy", GraphqlSortOrder.Desc);
					else props.updateFilter("orderBy", GraphqlSortOrder.Asc);
				}}
			>
				{props.filters.orderBy === GraphqlSortOrder.Asc ? (
					<IconSortAscending />
				) : (
					<IconSortDescending />
				)}
			</ActionIcon>
		</Flex>
	);
};
