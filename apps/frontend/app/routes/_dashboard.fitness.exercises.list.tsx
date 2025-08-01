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
	MantineThemeProvider,
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
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseSortBy,
	MergeExerciseDocument,
	UserExercisesListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getActionIntent,
	isNumber,
	parseSearchQuery,
	processSubmission,
	snakeCase,
	startCase,
	zodIntAsString,
} from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconCheck,
	IconFilter,
	IconPlus,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { Link, useLoaderData, useNavigate, useSubmit } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import {
	ApplicationPagination,
	DisplayListDetailsAndRefresh,
} from "~/components/common";
import {
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import { pageQueryParam } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useAppSearchParam,
	useCoreDetails,
	useIsFitnessActionActive,
	useNonHiddenUserCollections,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { getExerciseDetailsPath } from "~/lib/shared/media-utils";
import {
	convertEnumToSelectData,
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
} from "~/lib/state/general";
import {
	getSearchEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.fitness.exercises.list";

const defaultFiltersValue = {
	muscle: undefined,
	type: undefined,
	equipment: undefined,
	force: undefined,
	level: undefined,
	mechanic: undefined,
	sortBy: ExerciseSortBy.TimesPerformed,
	collection: undefined,
};

const searchParamsSchema = z.object({
	query: z.string().optional(),
	collection: z.string().optional(),
	[pageQueryParam]: zodIntAsString.optional(),
	type: z.enum(ExerciseLot).optional(),
	level: z.enum(ExerciseLevel).optional(),
	force: z.enum(ExerciseForce).optional(),
	sortBy: z.enum(ExerciseSortBy).optional(),
	muscle: z.enum(ExerciseMuscle).optional(),
	mechanic: z.enum(ExerciseMechanic).optional(),
	equipment: z.enum(ExerciseEquipment).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const cookieName = await getSearchEnhancedCookieName(
		"exercises.list",
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseSearchQuery(request, searchParamsSchema);
	query.sortBy = query.sortBy ?? defaultFiltersValue.sortBy;
	query[pageQueryParam] = query[pageQueryParam] ?? 1;
	const [{ userExercisesList }] = await Promise.all([
		serverGqlService.authenticatedRequest(
			request.clone(),
			UserExercisesListDocument,
			{
				input: {
					sortBy: query.sortBy,
					search: { page: query[pageQueryParam], query: query.query },
					filter: {
						type: query.type,
						level: query.level,
						force: query.force,
						muscle: query.muscle,
						mechanic: query.mechanic,
						equipment: query.equipment,
						collection: query.collection,
					},
				},
			},
		),
	]);
	const totalPages = await redirectToFirstPageIfOnInvalidPage({
		request,
		currentPage: query[pageQueryParam],
		totalResults: userExercisesList.response.details.total,
	});
	return { query, totalPages, cookieName, userExercisesList };
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

type SelectExercise = { name: string; lot: ExerciseLot };

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const userPreferences = useUserPreferences();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const isFitnessActionActive = useIsFitnessActionActive();
	const [mergingExercise, setMergingExercise] = useMergingExercise();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [selectedExercises, setSelectedExercises] =
		useListState<SelectExercise>([]);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const replacingExerciseId =
		currentWorkout?.replacingExerciseIdx &&
		currentWorkout.exercises[currentWorkout.replacingExerciseIdx].exerciseId;

	const isFilterChanged = Object.keys(defaultFiltersValue)
		.filter((k) => k !== pageQueryParam && k !== "query")
		.some(
			// biome-ignore lint/suspicious/noExplicitAny: required here
			(k) => (loaderData.query as any)[k] !== (defaultFiltersValue as any)[k],
		);

	const { data: replacingExercise } = useQuery({
		enabled: !!replacingExerciseId,
		...getExerciseDetailsQuery(replacingExerciseId || ""),
	});

	const allowAddingExerciseToWorkout =
		currentWorkout &&
		isFitnessActionActive &&
		!isNumber(currentWorkout.replacingExerciseIdx);

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
						initialValue={loaderData.query.query}
						enhancedQueryParams={loaderData.cookieName}
						placeholder="Search for exercises by name or instructions"
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
				{loaderData.userExercisesList.response.details.total > 0 ? (
					<>
						<DisplayListDetailsAndRefresh
							cacheId={loaderData.userExercisesList.cacheId}
							total={loaderData.userExercisesList.response.details.total}
							isRandomSortOrderSelected={
								loaderData.query.sortBy === ExerciseSortBy.Random
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
							{loaderData.userExercisesList.response.items.map((exercise) => (
								<ExerciseItemDisplay
									key={exercise}
									exerciseId={exercise}
									mergingExercise={mergingExercise}
									setMergingExercise={setMergingExercise}
									setSelectedExercises={setSelectedExercises}
									allowAddingExerciseToWorkout={allowAddingExerciseToWorkout}
								/>
							))}
						</SimpleGrid>
					</>
				) : (
					<Text>No information to display</Text>
				)}
				<ApplicationPagination
					total={loaderData.totalPages}
					value={loaderData.query[pageQueryParam]}
					onChange={(v) => setP(pageQueryParam, v.toString())}
				/>
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

const FiltersModalForm = () => {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const collections = useNonHiddenUserCollections();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	return (
		<MantineThemeProvider
			theme={{
				components: {
					Select: Select.extend({ defaultProps: { size: "xs" } }),
				},
			}}
		>
			<Stack gap={4}>
				<Select
					label="Sort by"
					onChange={(v) => setP("sortBy", v)}
					defaultValue={loaderData.query.sortBy}
					data={convertEnumToSelectData(ExerciseSortBy)}
				/>
				{Object.keys(defaultFiltersValue)
					.filter((f) => !["sortBy", "order", "collection"].includes(f))
					.map((f) => (
						<Select
							key={f}
							clearable
							// biome-ignore lint/suspicious/noExplicitAny: required here
							data={(coreDetails.exerciseParameters.filters as any)[f].map(
								// biome-ignore lint/suspicious/noExplicitAny: required here
								(v: any) => ({
									label: startCase(snakeCase(v)),
									value: v,
								}),
							)}
							label={startCase(f)}
							// biome-ignore lint/suspicious/noExplicitAny: required here
							defaultValue={(loaderData.query as any)[f]}
							onChange={(v) => setP(f, v)}
						/>
					))}
				<Select
					label="Collection"
					defaultValue={loaderData.query.collection?.toString()}
					data={[
						{
							group: "My collections",
							items: collections.map((c) => ({
								value: c.id.toString(),
								label: c.name,
							})),
						},
					]}
					onChange={(v) => setP("collection", v)}
					clearable
				/>
			</Stack>
		</MantineThemeProvider>
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
										name: props.exerciseId,
										lot: exercise.lot,
									});
									if (isTourTargetExercise) advanceOnboardingTourStep();
								} else
									props.setSelectedExercises.filter(
										(item) => item.name !== props.exerciseId,
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
