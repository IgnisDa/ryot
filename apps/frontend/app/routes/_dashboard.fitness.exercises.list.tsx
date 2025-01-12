import {
	ActionIcon,
	Affix,
	Alert,
	Anchor,
	Avatar,
	Box,
	Center,
	Checkbox,
	Container,
	Flex,
	Group,
	Indicator,
	MantineThemeProvider,
	Pagination,
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
import type {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaArgs,
} from "@remix-run/node";
import { Link, useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import {
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseSortBy,
	ExercisesListDocument,
	MergeExerciseDocument,
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
import { $path } from "remix-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput, FiltersModal } from "~/components/common";
import {
	dayjsLib,
	getExerciseDetailsPath,
	openConfirmationModal,
	pageQueryParam,
} from "~/lib/generals";
import {
	useAppSearchParam,
	useCoreDetails,
	useIsFitnessActionActive,
	useUserCollections,
	useUserPreferences,
} from "~/lib/hooks";
import {
	addExerciseToWorkout,
	getExerciseDetailsQuery,
	getUserExerciseDetailsQuery,
	useCurrentWorkout,
	useMergingExercise,
} from "~/lib/state/fitness";
import {
	getEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";

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
	[pageQueryParam]: zx.IntAsString.optional(),
	query: z.string().optional(),
	sortBy: z.nativeEnum(ExerciseSortBy).optional(),
	type: z.nativeEnum(ExerciseLot).optional(),
	level: z.nativeEnum(ExerciseLevel).optional(),
	force: z.nativeEnum(ExerciseForce).optional(),
	mechanic: z.nativeEnum(ExerciseMechanic).optional(),
	equipment: z.nativeEnum(ExerciseEquipment).optional(),
	muscle: z.nativeEnum(ExerciseMuscle).optional(),
	collection: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const cookieName = await getEnhancedCookieName("exercises.list", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	query.sortBy = query.sortBy ?? defaultFiltersValue.sortBy;
	query[pageQueryParam] = query[pageQueryParam] ?? 1;
	const [{ exercisesList }] = await Promise.all([
		serverGqlService.authenticatedRequest(
			request.clone(),
			ExercisesListDocument,
			{
				input: {
					search: { page: query[pageQueryParam], query: query.query },
					filter: {
						equipment: query.equipment,
						force: query.force,
						level: query.level,
						mechanic: query.mechanic,
						muscle: query.muscle,
						type: query.type,
						collection: query.collection,
					},
					sortBy: query.sortBy,
				},
			},
		),
	]);
	const totalPages = await redirectToFirstPageIfOnInvalidPage(
		request,
		exercisesList.details.total,
		query[pageQueryParam],
	);
	return { query, totalPages, cookieName, exercisesList };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Exercises | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
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
	const coreDetails = useCoreDetails();
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

	const isFilterChanged = Object.keys(defaultFiltersValue)
		.filter((k) => k !== pageQueryParam && k !== "query")
		.some(
			// biome-ignore lint/suspicious/noExplicitAny: required here
			(k) => (loaderData.query as any)[k] !== (defaultFiltersValue as any)[k],
		);

	const allowAddingExerciseToWorkout =
		currentWorkout &&
		isFitnessActionActive &&
		!isNumber(currentWorkout.replacingExerciseIdx);

	return (
		<Container size="md">
			<Stack gap="xl">
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
				{coreDetails.exerciseParameters.downloadRequired ? (
					<Alert icon={<IconAlertCircle />} variant="outline" color="violet">
						Please deploy a job to download the exercise dataset from the{" "}
						<Anchor
							size="sm"
							component={Link}
							to={$path("/settings/miscellaneous")}
						>
							miscellaneous settings
						</Anchor>
						.
					</Alert>
				) : (
					<>
						<Group wrap="nowrap">
							<DebouncedSearchInput
								initialValue={loaderData.query.query}
								enhancedQueryParams={loaderData.cookieName}
								placeholder="Search for exercises by name or instructions"
							/>
							<ActionIcon
								onClick={openFiltersModal}
								color={isFilterChanged ? "blue" : "gray"}
							>
								<IconFilter size={24} />
							</ActionIcon>
							<FiltersModal
								closeFiltersModal={closeFiltersModal}
								cookieName={loaderData.cookieName}
								opened={filtersModalOpened}
							>
								<FiltersModalForm />
							</FiltersModal>
						</Group>
						{currentWorkout?.replacingExerciseIdx ? (
							<Alert icon={<IconAlertCircle />}>
								You are replacing exercise:{" "}
								{
									currentWorkout.exercises[currentWorkout.replacingExerciseIdx]
										.exerciseId
								}
							</Alert>
						) : null}
						{mergingExercise ? (
							<Alert icon={<IconAlertCircle />}>
								You are merging exercise: {mergingExercise}
							</Alert>
						) : null}
						{loaderData.exercisesList.details.total > 0 ? (
							<>
								<Box>
									<Text display="inline" fw="bold">
										{loaderData.exercisesList.details.total}
									</Text>{" "}
									items found
									{allowAddingExerciseToWorkout ? (
										<>
											{" "}
											and{" "}
											<Text display="inline" fw="bold">
												{selectedExercises.length}
											</Text>{" "}
											selected
										</>
									) : null}
								</Box>
								<SimpleGrid cols={{ md: 2, lg: 3 }}>
									{loaderData.exercisesList.items.map((exercise) => (
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
						<Center>
							<Pagination
								size="sm"
								value={loaderData.query[pageQueryParam]}
								onChange={(v) => setP(pageQueryParam, v.toString())}
								total={loaderData.totalPages}
							/>
						</Center>
					</>
				)}
			</Stack>
			{allowAddingExerciseToWorkout ? (
				<Affix position={{ bottom: rem(40), right: rem(30) }}>
					<ActionIcon
						color="blue"
						variant="light"
						radius="xl"
						size="xl"
						disabled={selectedExercises.length === 0}
						onClick={async () => {
							await addExerciseToWorkout(
								navigate,
								currentWorkout,
								userPreferences.fitness,
								setCurrentWorkout,
								selectedExercises,
							);
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
	const collections = useUserCollections();
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
					data={Object.values(ExerciseSortBy).map((v) => ({
						label: startCase(snakeCase(v)),
						value: v,
					}))}
					label="Sort by"
					defaultValue={loaderData.query.sortBy}
					onChange={(v) => setP("sortBy", v)}
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

	return exercise && userExerciseDetails ? (
		<Flex gap="lg" align="center">
			{props.allowAddingExerciseToWorkout ? (
				<Checkbox
					onChange={(e) => {
						if (e.currentTarget.checked)
							props.setSelectedExercises.append({
								name: props.exerciseId,
								lot: exercise.lot,
							});
						else
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
					imageProps={{ loading: "lazy" }}
					src={exercise.attributes.images[0]}
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
	);
};
