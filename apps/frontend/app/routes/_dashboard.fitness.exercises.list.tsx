import {
	ActionIcon,
	Affix,
	Alert,
	Avatar,
	Box,
	Checkbox,
	Container,
	Flex,
	Group,
	Indicator,
	Select,
	SimpleGrid,
	Skeleton,
	Stack,
	Text,
	Title,
	rem,
} from "@mantine/core";
import {
	type UseListStateHandlers,
	useDisclosure,
	useInViewport,
	useListState,
} from "@mantine/hooks";
import {
	type ExerciseEquipment,
	type ExerciseForce,
	type ExerciseLevel,
	type ExerciseLot,
	type ExerciseMechanic,
	type ExerciseMuscle,
	ExerciseSortBy,
	MergeExerciseDocument,
	UserExercisesListDocument,
	type UserExercisesListInput,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getActionIntent,
	isNumber,
	processSubmission,
	snakeCase,
	startCase,
} from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconCheck,
	IconFilter,
	IconPlus,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { Link, useNavigate, useSubmit } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
	ApplicationPagination,
	DisplayListDetailsAndRefresh,
	SkeletonLoader,
} from "~/components/common";
import {
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useIsFitnessActionActive,
	useNonHiddenUserCollections,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { getExerciseDetailsPath } from "~/lib/shared/media-utils";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	isFilterChanged,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import {
	addExerciseToCurrentWorkout,
	getExerciseDetailsQuery,
	getExerciseImages,
	getUserExerciseDetailsQuery,
	useCurrentWorkout,
	useMergingExercise,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	TOUR_EXERCISE_TARGET_ID,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import type { FilterUpdateFunction } from "~/lib/types";
import { redirectWithToast, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.fitness.exercises.list";

interface FilterState {
	page: number;
	query: string;
	type?: ExerciseLot;
	collection?: string;
	level?: ExerciseLevel;
	force?: ExerciseForce;
	sortBy: ExerciseSortBy;
	muscle?: ExerciseMuscle;
	mechanic?: ExerciseMechanic;
	equipment?: ExerciseEquipment;
}

const defaultFilters: FilterState = {
	page: 1,
	query: "",
	type: undefined,
	force: undefined,
	level: undefined,
	muscle: undefined,
	mechanic: undefined,
	equipment: undefined,
	collection: undefined,
	sortBy: ExerciseSortBy.TimesPerformed,
};

export const meta = () => {
	return [{ title: "Exercises | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("mergeExercise", async () => {
			const submission = processSubmission(formData, mergeExerciseSchema);
			await serverGqlService.authenticatedRequest(
				request,
				MergeExerciseDocument,
				submission,
			);
			return redirectWithToast(getExerciseDetailsPath(submission.mergeInto), {
				type: "success",
				message: "Exercise merged successfully",
			});
		})
		.run();
};

const mergeExerciseSchema = z.object({
	mergeFrom: z.string(),
	mergeInto: z.string(),
});

type SelectExercise = { id: string; lot: ExerciseLot };

export default function Page() {
	const navigate = useNavigate();
	const userPreferences = useUserPreferences();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const isFitnessActionActive = useIsFitnessActionActive();
	const [mergingExercise, setMergingExercise] = useMergingExercise();
	const [filters, setFilters] = useLocalStorage(
		"ExerciseListFilters",
		defaultFilters,
	);
	const [selectedExercises, setSelectedExercises] =
		useListState<SelectExercise>([]);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const queryInput: UserExercisesListInput = {
		sortBy: filters.sortBy,
		search: { page: filters.page, query: filters.query },
		filter: {
			type: filters.type,
			level: filters.level,
			force: filters.force,
			muscle: filters.muscle,
			mechanic: filters.mechanic,
			equipment: filters.equipment,
			collection: filters.collection,
		},
	};

	const { data: userExercisesList, refetch: refetchUserExercisesList } =
		useQuery({
			queryKey: queryFactory.fitness.userExercisesList(queryInput).queryKey,
			queryFn: () =>
				clientGqlService
					.request(UserExercisesListDocument, { input: queryInput })
					.then((data) => data.userExercisesList),
		});

	const replacingExerciseId =
		currentWorkout?.replacingExerciseIdx &&
		currentWorkout.exercises[currentWorkout.replacingExerciseIdx].exerciseId;

	const areListFiltersActive = isFilterChanged(filters, defaultFilters);

	const { data: replacingExercise } = useQuery({
		enabled: !!replacingExerciseId,
		...getExerciseDetailsQuery(replacingExerciseId || ""),
	});

	const allowAddingExerciseToWorkout =
		currentWorkout &&
		isFitnessActionActive &&
		!isNumber(currentWorkout.replacingExerciseIdx);

	const updateFilter: FilterUpdateFunction<FilterState> = (key, value) =>
		setFilters((prev) => ({ ...prev, [key]: value }));

	return (
		<Container size="md">
			<Stack>
				<Flex align="center" gap="md">
					<Title>Exercises</Title>
					<ActionIcon
						color="green"
						component={Link}
						variant="outline"
						to={$path("/fitness/exercises/:action", { action: "create" })}
					>
						<IconPlus size={16} />
					</ActionIcon>
				</Flex>
				<Group wrap="nowrap">
					<DebouncedSearchInput
						value={filters.query}
						placeholder="Search for exercises by name or instructions"
						onChange={(value) => {
							updateFilter("query", value);
							updateFilter("page", 1);
						}}
						tourControl={{
							target: OnboardingTourStepTargets.SearchForExercise,
							onQueryChange: (query) => {
								if (query === TOUR_EXERCISE_TARGET_ID.toLowerCase()) {
									advanceOnboardingTourStep();
								}
							},
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
						resetFilters={() => setFilters(defaultFilters)}
					>
						<FiltersModalForm filter={filters} updateFilter={updateFilter} />
					</FiltersModal>
				</Group>
				{currentWorkout?.replacingExerciseIdx ? (
					<Alert icon={<IconAlertCircle />}>
						You are replacing exercise: {replacingExercise?.name}
					</Alert>
				) : null}
				{mergingExercise ? (
					<Alert icon={<IconAlertCircle />}>
						You are merging exercise: {mergingExercise}
					</Alert>
				) : null}
				{userExercisesList ? (
					<>
						{userExercisesList.response.details.totalItems > 0 ? (
							<>
								<DisplayListDetailsAndRefresh
									cacheId={userExercisesList.cacheId}
									onRefreshButtonClicked={refetchUserExercisesList}
									total={userExercisesList.response.details.totalItems}
									isRandomSortOrderSelected={
										filters.sortBy === ExerciseSortBy.Random
									}
									rightSection={
										allowAddingExerciseToWorkout ? (
											<>
												{" "}
												and{" "}
												<Text display="inline" fw="bold">
													{selectedExercises.length}
												</Text>{" "}
												selected
											</>
										) : null
									}
								/>
								<SimpleGrid cols={{ md: 2, lg: 3 }}>
									{userExercisesList.response.items.map((exercise) => (
										<ExerciseItemDisplay
											key={exercise}
											exerciseId={exercise}
											mergingExercise={mergingExercise}
											setMergingExercise={setMergingExercise}
											setSelectedExercises={setSelectedExercises}
											allowAddingExerciseToWorkout={
												allowAddingExerciseToWorkout
											}
										/>
									))}
								</SimpleGrid>
							</>
						) : (
							<Text>No information to display</Text>
						)}
						<ApplicationPagination
							value={filters.page}
							onChange={(v) => updateFilter("page", v)}
							totalItems={userExercisesList.response.details.totalItems}
						/>
					</>
				) : (
					<SkeletonLoader />
				)}
			</Stack>
			{allowAddingExerciseToWorkout ? (
				<Affix position={{ bottom: rem(40), right: rem(30) }}>
					<ActionIcon
						size="xl"
						radius="xl"
						color="blue"
						variant="light"
						disabled={selectedExercises.length === 0}
						className={OnboardingTourStepTargets.AddSelectedExerciseToWorkout}
						onClick={async () => {
							await addExerciseToCurrentWorkout(
								navigate,
								currentWorkout,
								userPreferences.fitness,
								setCurrentWorkout,
								selectedExercises,
							);
							advanceOnboardingTourStep();
						}}
					>
						<IconCheck size={32} />
					</ActionIcon>
				</Affix>
			) : null}
		</Container>
	);
}

const FiltersModalForm = (props: {
	filter: FilterState;
	updateFilter: FilterUpdateFunction<FilterState>;
}) => {
	const coreDetails = useCoreDetails();
	const collections = useNonHiddenUserCollections();

	return (
		<Stack gap={4}>
			<Select
				size="xs"
				label="Sort by"
				defaultValue={props.filter.sortBy}
				data={convertEnumToSelectData(ExerciseSortBy)}
				onChange={(v) => props.updateFilter("sortBy", v as ExerciseSortBy)}
			/>
			{Object.keys(defaultFilters)
				.filter((f) => !["sortBy", "collection", "page", "query"].includes(f))
				.map((f) => (
					<Select
						key={f}
						size="xs"
						clearable
						label={startCase(f)}
						// biome-ignore lint/suspicious/noExplicitAny: required here
						defaultValue={(props.filter as any)[f]}
						onChange={(v) => props.updateFilter(f as keyof FilterState, v)}
						// biome-ignore lint/suspicious/noExplicitAny: required here
						data={(coreDetails.exerciseParameters.filters as any)[f].map(
							// biome-ignore lint/suspicious/noExplicitAny: required here
							(v: any) => ({
								value: v,
								label: startCase(snakeCase(v)),
							}),
						)}
					/>
				))}
			<Select
				clearable
				size="xs"
				label="Collection"
				defaultValue={props.filter.collection?.toString()}
				onChange={(v) => props.updateFilter("collection", v)}
				data={[
					{
						group: "My collections",
						items:
							collections?.map((c) => ({
								label: c.name,
								value: c.id.toString(),
							})) || [],
					},
				]}
			/>
		</Stack>
	);
};

const ExerciseItemDisplay = (props: {
	exerciseId: string;
	mergingExercise: string | null;
	allowAddingExerciseToWorkout: boolean | null;
	setMergingExercise: (value: string | null) => void;
	setSelectedExercises: UseListStateHandlers<SelectExercise>;
}) => {
	const submit = useSubmit();
	const navigate = useNavigate();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const { ref, inViewport } = useInViewport();
	const { data: exercise } = useQuery({
		...getExerciseDetailsQuery(props.exerciseId),
		enabled: inViewport,
	});
	const { data: userExerciseDetails } = useQuery({
		...getUserExerciseDetailsQuery(props.exerciseId),
		enabled: inViewport,
	});

	const firstMuscle = exercise?.muscles?.at(0);
	const numTimesInteracted =
		userExerciseDetails?.details?.exerciseNumTimesInteracted;
	const lastUpdatedOn = userExerciseDetails?.details?.lastUpdatedOn;
	const isTourTargetExercise = props.exerciseId === TOUR_EXERCISE_TARGET_ID;
	const images = getExerciseImages(exercise);

	return (
		<Box
			data-exercise-id={props.exerciseId}
			className={
				isTourTargetExercise
					? OnboardingTourStepTargets.SelectExercise
					: undefined
			}
		>
			{exercise && userExerciseDetails ? (
				<Flex gap="lg" align="center">
					{props.allowAddingExerciseToWorkout ? (
						<Checkbox
							onChange={(e) => {
								if (e.currentTarget.checked) {
									props.setSelectedExercises.append({
										lot: exercise.lot,
										id: props.exerciseId,
									});
									if (isTourTargetExercise) advanceOnboardingTourStep();
								} else
									props.setSelectedExercises.filter(
										(item) => item.id !== props.exerciseId,
									);
							}}
						/>
					) : null}
					<Indicator
						size={16}
						offset={8}
						color="grape"
						position="top-start"
						disabled={!numTimesInteracted}
						label={numTimesInteracted ?? ""}
					>
						<Avatar
							size="lg"
							radius="xl"
							src={images.at(0)}
							imageProps={{ loading: "lazy" }}
						/>
					</Indicator>
					<Link
						style={{ all: "unset", cursor: "pointer" }}
						to={getExerciseDetailsPath(props.exerciseId)}
						onClick={(e) => {
							if (props.allowAddingExerciseToWorkout) return;
							if (props.mergingExercise) {
								e.preventDefault();
								openConfirmationModal(
									"Are you sure you want to merge this exercise? This will replace this exercise in all workouts.",
									() => {
										const formData = new FormData();
										if (props.mergingExercise)
											formData.append("mergeFrom", props.mergingExercise);
										formData.append("mergeInto", props.exerciseId);
										props.setMergingExercise(null);
										submit(formData, {
											method: "POST",
											action: withQuery(".", {
												intent: "mergeExercise",
											}),
										});
									},
								);
								return;
							}
							if (currentWorkout) {
								e.preventDefault();
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										if (!isNumber(currentWorkout.replacingExerciseIdx)) return;
										draft.exercises[
											currentWorkout.replacingExerciseIdx
										].exerciseId = props.exerciseId;
										draft.replacingExerciseIdx = undefined;
									}),
								);
								navigate(-1);
								return;
							}
						}}
					>
						<Flex direction="column" justify="space-around">
							<Text>{exercise.name}</Text>
							<Flex>
								{firstMuscle ? (
									<Text size="xs">{startCase(snakeCase(firstMuscle))}</Text>
								) : null}
								{lastUpdatedOn ? (
									<Text size="xs" c="dimmed">
										{firstMuscle ? "," : null}{" "}
										{dayjsLib(lastUpdatedOn).format("D MMM")}
									</Text>
								) : null}
							</Flex>
						</Flex>
					</Link>
				</Flex>
			) : (
				<Skeleton height={56} ref={ref} />
			)}
		</Box>
	);
};
