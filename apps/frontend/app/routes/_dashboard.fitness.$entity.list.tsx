import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Sparkline } from "@mantine/charts";
import {
	ActionIcon,
	Anchor,
	Box,
	Center,
	Container,
	Divider,
	Flex,
	Group,
	Pagination,
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
import {
	changeCase,
	humanizeDuration,
	parseParameters,
	parseSearchQuery,
	truncate,
	zodIntAsString,
} from "@ryot/ts-utils";
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
import { Link, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { DisplayListDetailsAndRefresh } from "~/components/common";
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
import { PRO_REQUIRED_MESSAGE, pageQueryParam } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useAppSearchParam,
	useCoreDetails,
	useGetWorkoutStarter,
	useUserUnitSystem,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/query-factory";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import {
	getDefaultWorkout,
	getExerciseDetailsQuery,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import { FitnessAction, FitnessEntity } from "~/lib/types";
import {
	getSearchEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.fitness.$entity.list";

const defaultFilters = {
	orderBy: GraphqlSortOrder.Desc,
	sortBy: UserTemplatesOrWorkoutsListSortBy.Time,
};

const searchParamsSchema = z.object({
	query: z.string().optional(),
	[pageQueryParam]: zodIntAsString.default("1"),
	orderBy: z.nativeEnum(GraphqlSortOrder).default(defaultFilters.orderBy),
	sortBy: z
		.nativeEnum(UserTemplatesOrWorkoutsListSortBy)
		.default(defaultFilters.sortBy),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ params, request }: Route.LoaderArgs) => {
	const { entity } = parseParameters(
		params,
		z.object({ entity: z.nativeEnum(FitnessEntity) }),
	);
	const cookieName = await getSearchEnhancedCookieName(
		`${entity}.list`,
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseSearchQuery(request, searchParamsSchema);
	const input: UserTemplatesOrWorkoutsListInput = {
		sort: { by: query.sortBy, order: query.orderBy },
		search: { query: query.query, page: query[pageQueryParam] },
	};
	const displayData = await match(entity)
		.with(FitnessEntity.Workouts, async () => {
			const { userWorkoutsList } = await serverGqlService.authenticatedRequest(
				request,
				UserWorkoutsListDocument,
				{ input },
			);
			return {
				cacheId: userWorkoutsList.cacheId,
				items: userWorkoutsList.response.items,
				details: userWorkoutsList.response.details,
			};
		})
		.with(FitnessEntity.Templates, async () => {
			const { userWorkoutTemplatesList } =
				await serverGqlService.authenticatedRequest(
					request,
					UserWorkoutTemplatesListDocument,
					{ input },
				);
			return {
				cacheId: userWorkoutTemplatesList.cacheId,
				items: userWorkoutTemplatesList.response.items,
				details: userWorkoutTemplatesList.response.details,
			};
		})
		.exhaustive();
	const totalPages = await redirectToFirstPageIfOnInvalidPage({
		request,
		currentPage: query[pageQueryParam],
		totalResults: displayData.details.total,
	});
	return { query, entity, displayData, cookieName, totalPages };
};

export const meta = ({ data }: Route.MetaArgs) => {
	return [{ title: `${changeCase(data?.entity || "")} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const startWorkout = useGetWorkoutStarter();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const isFilterChanged =
		loaderData.query.sortBy !== defaultFilters.sortBy ||
		loaderData.query.orderBy !== defaultFilters.orderBy;

	return (
		<Container size="xs">
			<Stack>
				<WorkoutRevisionScheduledAlert />
				<Flex align="center" gap="md">
					<Title>{changeCase(loaderData.entity)}</Title>
					<ActionIcon
						color="green"
						variant="outline"
						className={OnboardingTourStepTargets.AddNewWorkout}
						onClick={async () => {
							if (
								!coreDetails.isServerKeyValidated &&
								loaderData.entity === FitnessEntity.Templates
							) {
								notifications.show({
									color: "red",
									message: PRO_REQUIRED_MESSAGE,
								});
								return;
							}
							const action = match(loaderData.entity)
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
						initialValue={loaderData.query.query}
						enhancedQueryParams={loaderData.cookieName}
						placeholder={`Search for ${loaderData.entity}`}
					/>
					<ActionIcon
						onClick={openFiltersModal}
						color={isFilterChanged ? "blue" : "gray"}
					>
						<IconFilter size={24} />
					</ActionIcon>
					<FiltersModal
						opened={filtersModalOpened}
						cookieName={loaderData.cookieName}
						closeFiltersModal={closeFiltersModal}
					>
						<FiltersModalForm />
					</FiltersModal>
				</Group>
				<Stack gap="xs">
					<DisplayListDetailsAndRefresh
						cacheId={loaderData.displayData.cacheId}
						total={loaderData.displayData.details.total}
						isRandomSortOrderSelected={
							loaderData.query.sortBy ===
							UserTemplatesOrWorkoutsListSortBy.Random
						}
					/>
					{loaderData.displayData.items.length > 0 ? (
						loaderData.displayData.items.map((entityId, index) => (
							<DisplayFitnessEntity
								index={index}
								key={entityId}
								entityId={entityId}
							/>
						))
					) : (
						<Text>No {loaderData.entity} found</Text>
					)}
				</Stack>
				<Center>
					<Pagination
						size="sm"
						total={loaderData.totalPages}
						value={loaderData.query[pageQueryParam]}
						onChange={(v) => setP(pageQueryParam, v.toString())}
					/>
				</Center>
			</Stack>
		</Container>
	);
}

const DisplayFitnessEntity = (props: { entityId: string; index: number }) => {
	const loaderData = useLoaderData<typeof loader>();
	const unitSystem = useUserUnitSystem();
	const { ref, inViewport } = useInViewport();
	const [parent] = useAutoAnimate();
	const [showDetails, setShowDetails] = useDisclosure(false);

	const { data: entityInformation } = useQuery({
		enabled: inViewport,
		queryKey: ["fitnessEntityDetails", props.entityId],
		queryFn: () =>
			match(loaderData.entity)
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
									entity: loaderData.entity,
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
								icon={match(loaderData.entity)
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
							{loaderData.entity === FitnessEntity.Workouts ? (
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

const FiltersModalForm = () => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	return (
		<>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					defaultValue={loaderData.query.sortBy}
					onChange={(v) => setP("sortBy", v)}
					data={convertEnumToSelectData(UserTemplatesOrWorkoutsListSortBy)}
				/>
				<ActionIcon
					onClick={() => {
						if (loaderData.query.orderBy === GraphqlSortOrder.Asc)
							setP("orderBy", GraphqlSortOrder.Desc);
						else setP("orderBy", GraphqlSortOrder.Asc);
					}}
				>
					{loaderData.query.orderBy === GraphqlSortOrder.Asc ? (
						<IconSortAscending />
					) : (
						<IconSortDescending />
					)}
				</ActionIcon>
			</Flex>
		</>
	);
};
