import {
	ActionIcon,
	Affix,
	Alert,
	Avatar,
	Box,
	Checkbox,
	Container,
	Divider,
	Flex,
	Group,
	Indicator,
	MultiSelect,
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
	EntityLot,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseSortBy,
	FilterPresetContextType,
	MergeExerciseDocument,
	UserExercisesListDocument,
	type UserExercisesListInput,
} from "@ryot/generated/graphql/backend/graphql";
import {
	cloneDeep,
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
import {
	type inferParserType,
	parseAsArrayOf,
	parseAsInteger,
	parseAsString,
	parseAsStringEnum,
} from "nuqs";
import { useMemo } from "react";
import { Link, useNavigate, useSubmit } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
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
	CollectionsFilter,
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import type { FilterUpdateFunction } from "~/lib/hooks/filters/types";
import { useFilterPresets } from "~/lib/hooks/filters/use-presets";
import { useFiltersState } from "~/lib/hooks/filters/use-state";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useExerciseDetails,
	useIsFitnessActionActive,
	useUserExerciseDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { getExerciseDetailsPath } from "~/lib/shared/media-utils";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import { parseAsCollectionsFilter } from "~/lib/shared/validation";
import { useBulkEditCollection } from "~/lib/state/collection";
import {
	addExerciseToCurrentWorkout,
	useCurrentWorkout,
	useExerciseImages,
	useMergingExercise,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTarget,
	TOUR_EXERCISE_TARGET_ID,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import { redirectWithToast, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.fitness.exercises.list";

const defaultQueryState = {
	page: parseAsInteger.withDefault(1),
	query: parseAsString.withDefault(""),
	collections: parseAsCollectionsFilter.withDefault([]),
	types: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseLot)),
	).withDefault([]),
	sortBy: parseAsStringEnum(Object.values(ExerciseSortBy)).withDefault(
		ExerciseSortBy.TimesPerformed,
	),
	levels: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseLevel)),
	).withDefault([]),
	forces: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseForce)),
	).withDefault([]),
	muscles: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseMuscle)),
	).withDefault([]),
	mechanics: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseMechanic)),
	).withDefault([]),
	equipments: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseEquipment)),
	).withDefault([]),
};

type FilterState = inferParserType<typeof defaultQueryState>;

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
	const bulkEditingCollection = useBulkEditCollection();
	const isFitnessActionActive = useIsFitnessActionActive();
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [mergingExercise, setMergingExercise] = useMergingExercise();
	const [selectedExercises, setSelectedExercises] =
		useListState<SelectExercise>([]);
	const { filters, resetFilters, updateFilters, haveFiltersChanged } =
		useFiltersState(defaultQueryState);

	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [
		presetModalOpened,
		{ open: openPresetModal, close: closePresetModal },
	] = useDisclosure(false);

	const bulkEditingState =
		bulkEditingCollection.state === false ? null : bulkEditingCollection.state;

	const listPresets = useFilterPresets({
		filters,
		updateFilters,
		enabled: true,
		contextType: FilterPresetContextType.ExercisesList,
	});

	const queryInput: UserExercisesListInput = useMemo(
		() => ({
			sortBy: filters.sortBy,
			search: { page: filters.page, query: filters.query },
			filter: {
				types: filters.types,
				levels: filters.levels,
				forces: filters.forces,
				muscles: filters.muscles,
				mechanics: filters.mechanics,
				equipments: filters.equipments,
				collections: filters.collections,
			},
		}),
		[filters],
	);

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

	const { data: replacingExercise } = useExerciseDetails(
		replacingExerciseId || "",
		!!replacingExerciseId,
	);

	const allowAddingExerciseToWorkout =
		currentWorkout &&
		isFitnessActionActive &&
		!isNumber(currentWorkout.replacingExerciseIdx);

	return (
		<>
			<FilterPresetModalManager
				opened={presetModalOpened}
				onClose={closePresetModal}
				presetManager={listPresets}
				placeholder="e.g., Push Day Machines"
			/>
			<BulkCollectionEditingAffix
				bulkAddEntities={async () => {
					if (bulkEditingState?.data.action !== "add") return [];
					const bulkQueryInput = cloneDeep(queryInput);
					bulkQueryInput.search = {
						...(bulkQueryInput.search ?? {}),
						take: Number.MAX_SAFE_INTEGER,
						page: 1,
					};

					const { userExercisesList } = await clientGqlService.request(
						UserExercisesListDocument,
						{ input: bulkQueryInput },
					);
					return userExercisesList.response.items.map((exerciseId) => ({
						entityId: exerciseId,
						entityLot: EntityLot.Exercise,
					}));
				}}
			/>
			<Container size="md">
				<Stack>
					<Flex align="center" gap="md">
						<Title>Exercises</Title>
						<ActionIcon
							color="green"
							component={Link}
							variant="outline"
							to={$path("/fitness/exercises/update/:action", {
								action: "create",
							})}
						>
							<IconPlus size={16} />
						</ActionIcon>
					</Flex>
					<Group wrap="nowrap">
						<DebouncedSearchInput
							value={filters.query}
							placeholder="Search for exercises by name or instructions"
							onChange={(value) => updateFilters({ query: value })}
							tourControl={{
								target: OnboardingTourStepTarget.SearchForExercise,
								onQueryChange: (query) => {
									if (query === TOUR_EXERCISE_TARGET_ID.toLowerCase()) {
										advanceOnboardingTourStep();
									}
								},
							}}
						/>
						<ActionIcon
							onClick={openFiltersModal}
							color={haveFiltersChanged ? "blue" : "gray"}
						>
							<IconFilter size={24} />
						</ActionIcon>
						<FiltersModal
							resetFilters={resetFilters}
							opened={filtersModalOpened}
							onSavePreset={openPresetModal}
							closeFiltersModal={closeFiltersModal}
						>
							<FiltersModalForm
								filter={filters}
								updateFilter={(key, value) => updateFilters({ [key]: value })}
							/>
						</FiltersModal>
					</Group>
					<FilterPresetBar presetManager={listPresets} />
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
								onChange={(page) => updateFilters({ page })}
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
							className={OnboardingTourStepTarget.AddSelectedExerciseToWorkout}
							onClick={async () => {
								setMergingExercise(null);
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
		</>
	);
}

const FiltersModalForm = (props: {
	filter: FilterState;
	updateFilter: FilterUpdateFunction<FilterState>;
}) => {
	const coreDetails = useCoreDetails();

	return (
		<Stack gap={4}>
			<Select
				size="xs"
				label="Sort by"
				value={props.filter.sortBy}
				data={convertEnumToSelectData(ExerciseSortBy)}
				onChange={(v) => props.updateFilter("sortBy", v as ExerciseSortBy)}
			/>
			<Stack gap={2}>
				{[
					"types",
					"levels",
					"forces",
					"muscles",
					"mechanics",
					"equipments",
				].map((f) => {
					const singularKey = f.endsWith("s") ? f.slice(0, -1) : f;
					return (
						<MultiSelect
							key={f}
							size="xs"
							clearable
							searchable
							label={startCase(f)}
							// biome-ignore lint/suspicious/noExplicitAny: required here
							value={(props.filter as any)[f]}
							onChange={(v) =>
								// biome-ignore lint/suspicious/noExplicitAny: required here
								props.updateFilter(f as keyof FilterState, v as any)
							}
							// biome-ignore lint/suspicious/noExplicitAny: required here
							data={(coreDetails.exerciseParameters.filters as any)[
								singularKey
							].map(
								// biome-ignore lint/suspicious/noExplicitAny: required here
								(v: any) => ({
									value: v,
									label: startCase(snakeCase(v)),
								}),
							)}
						/>
					);
				})}
			</Stack>
			<Divider mt="md" mb="xs" />
			<CollectionsFilter
				applied={props.filter.collections}
				onFiltersChanged={(val) => props.updateFilter("collections", val)}
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
	const { data: exercise } = useExerciseDetails(props.exerciseId, inViewport);
	const { data: userExerciseDetails } = useUserExerciseDetails(
		props.exerciseId,
		inViewport,
	);
	const bulkEditingCollection = useBulkEditCollection();
	const rawBulkEditingState = bulkEditingCollection.state;
	const bulkEditingState =
		rawBulkEditingState === false ? null : rawBulkEditingState;
	const becItem = { entityId: props.exerciseId, entityLot: EntityLot.Exercise };
	const isAlreadyPresent = bulkEditingCollection.isAlreadyPresent(becItem);
	const isAdded = bulkEditingCollection.isAdded(becItem);

	const firstMuscle = exercise?.muscles?.at(0);
	const numTimesInteracted =
		userExerciseDetails?.details?.exerciseNumTimesInteracted;
	const lastUpdatedOn = userExerciseDetails?.details?.lastUpdatedOn;
	const isTourTargetExercise = props.exerciseId === TOUR_EXERCISE_TARGET_ID;
	const images = useExerciseImages(exercise);

	return (
		<Box
			data-exercise-id={props.exerciseId}
			className={
				isTourTargetExercise
					? OnboardingTourStepTarget.SelectExercise
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
					{bulkEditingState &&
					bulkEditingState.data.action === "add" &&
					!isAlreadyPresent ? (
						<ActionIcon
							ml="auto"
							color="green"
							variant={isAdded ? "filled" : "outline"}
							disabled={bulkEditingState.data.isLoading}
							onClick={() => {
								if (isAdded) bulkEditingState.remove(becItem);
								else bulkEditingState.add(becItem);
							}}
						>
							<IconCheck size={18} />
						</ActionIcon>
					) : null}
				</Flex>
			) : (
				<Skeleton height={56} ref={ref} />
			)}
		</Box>
	);
};
