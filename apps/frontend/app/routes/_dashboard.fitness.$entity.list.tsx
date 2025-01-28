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
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
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
	startCase,
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
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import {
	DebouncedSearchInput,
	DisplayListDetailsAndRefresh,
	FiltersModal,
} from "~/components/common";
import {
	displayDistanceWithUnit,
	displayWeightWithUnit,
	getSetStatisticsTextToDisplay,
} from "~/components/fitness";
import {
	FitnessAction,
	FitnessEntity,
	PRO_REQUIRED_MESSAGE,
	clientGqlService,
	dayjsLib,
	pageQueryParam,
} from "~/lib/generals";
import {
	useAppSearchParam,
	useCoreDetails,
	useGetWorkoutStarter,
	useUserUnitSystem,
} from "~/lib/hooks";
import {
	getDefaultWorkout,
	getExerciseDetailsQuery,
} from "~/lib/state/fitness";
import {
	getEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	query: z.string().optional(),
	[pageQueryParam]: zodIntAsString.default("1"),
	orderBy: z.nativeEnum(GraphqlSortOrder).optional(),
	sortBy: z.nativeEnum(UserTemplatesOrWorkoutsListSortBy).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
	const { entity } = parseParameters(
		params,
		z.object({ entity: z.nativeEnum(FitnessEntity) }),
	);
	const cookieName = await getEnhancedCookieName(`${entity}.list`, request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseSearchQuery(request, searchParamsSchema);
	const input: UserTemplatesOrWorkoutsListInput = {
		sort: { by: query.sortBy, order: query.orderBy },
		search: {
			query: query.query,
			page: query[pageQueryParam],
		},
	};
	const itemList = await match(entity)
		.with(FitnessEntity.Workouts, async () => {
			const { userWorkoutsList } = await serverGqlService.authenticatedRequest(
				request,
				UserWorkoutsListDocument,
				{ input },
			);
			return {
				items: userWorkoutsList.items,
				details: userWorkoutsList.details,
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
				items: userWorkoutTemplatesList.items,
				details: userWorkoutTemplatesList.details,
			};
		})
		.exhaustive();
	const totalPages = await redirectToFirstPageIfOnInvalidPage(
		request,
		itemList.details.total,
		query[pageQueryParam],
	);
	return { query, entity, itemList, cookieName, totalPages };
};

export const meta = ({ data }: MetaArgs<typeof loader>) => {
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

	return (
		<Container size="xs">
			<Stack>
				<Flex align="center" gap="md">
					<Title>{changeCase(loaderData.entity)}</Title>
					<ActionIcon
						color="green"
						variant="outline"
						onClick={() => {
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
					<ActionIcon onClick={openFiltersModal}>
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
				{loaderData.itemList.items.length > 0 ? (
					<Stack gap="xs">
						<DisplayListDetailsAndRefresh
							cacheId={"abcd"}
							total={loaderData.itemList.details.total}
						/>
						{loaderData.itemList.items.map((entityId, index) => (
							<DisplayFitnessEntity
								index={index}
								key={entityId}
								entityId={entityId}
							/>
						))}
					</Stack>
				) : (
					<Text>No {loaderData.entity} found</Text>
				)}
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
								{dayjsLib(entityInformation.timestamp).format("LL")}
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
	const unitSystem = useUserUnitSystem();
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
				unitSystem,
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
					onChange={(v) => setP("sortBy", v)}
					defaultValue={
						loaderData.query.sortBy || UserTemplatesOrWorkoutsListSortBy.Time
					}
					data={Object.values(UserTemplatesOrWorkoutsListSortBy).map((o) => ({
						value: o.toString(),
						label: startCase(o.toLowerCase()),
					}))}
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
