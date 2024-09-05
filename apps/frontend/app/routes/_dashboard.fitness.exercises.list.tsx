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
	Stack,
	Text,
	Title,
	rem,
} from "@mantine/core";
import { useDisclosure, useListState } from "@mantine/hooks";
import { unstable_defineLoader } from "@remix-run/node";
import {
	Link,
	type MetaArgs_SingleFetch,
	useLoaderData,
	useNavigate,
} from "@remix-run/react";
import {
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseSortBy,
	ExercisesListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconCheck,
	IconFilter,
	IconPlus,
} from "@tabler/icons-react";
import { $path } from "remix-routes";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput, FiltersModal } from "~/components/common";
import { dayjsLib, pageQueryParam } from "~/lib/generals";
import {
	useAppSearchParam,
	useCoreDetails,
	useUserCollections,
} from "~/lib/hooks";
import { addExerciseToWorkout, useCurrentWorkout } from "~/lib/state/fitness";
import {
	getCachedExerciseParameters,
	getEnhancedCookieName,
	getWorkoutCookieValue,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
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

export const loader = unstable_defineLoader(async ({ request }) => {
	const cookieName = await getEnhancedCookieName("exercises.list", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const workoutInProgress = !!getWorkoutCookieValue(request);
	query.sortBy = query.sortBy ?? defaultFiltersValue.sortBy;
	query[pageQueryParam] = query[pageQueryParam] ?? 1;
	const [exerciseParameters, { exercisesList }] = await Promise.all([
		getCachedExerciseParameters(),
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
	await redirectToFirstPageIfOnInvalidPage(
		request,
		exercisesList.details.total,
		query[pageQueryParam],
	);
	return {
		query,
		cookieName,
		exercisesList,
		workoutInProgress,
		exerciseParameters,
	};
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Exercises | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const navigate = useNavigate();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [selectedExercises, setSelectedExercises] = useListState<{
		name: string;
		lot: ExerciseLot;
	}>([]);
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();

	const isFilterChanged = Object.keys(defaultFiltersValue)
		.filter((k) => k !== pageQueryParam && k !== "query")
		.some(
			// biome-ignore lint/suspicious/noExplicitAny: required here
			(k) => (loaderData.query as any)[k] !== (defaultFiltersValue as any)[k],
		);

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
				{loaderData.exerciseParameters.downloadRequired ? (
					<Alert icon={<IconAlertCircle />} variant="outline" color="violet">
						Please deploy a job to download the exercise dataset from the{" "}
						<Anchor
							component={Link}
							to={$path("/settings/miscellaneous")}
							size="sm"
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
						{loaderData.exercisesList.details.total > 0 ? (
							<>
								<Box>
									<Text display="inline" fw="bold">
										{loaderData.exercisesList.details.total}
									</Text>{" "}
									items found
									{currentWorkout ? (
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
										<Flex
											key={exercise.id}
											gap="lg"
											align="center"
											data-exercise-id={exercise.id}
										>
											{currentWorkout ? (
												<Checkbox
													onChange={(e) => {
														if (e.currentTarget.checked)
															setSelectedExercises.append({
																name: exercise.id,
																lot: exercise.lot,
															});
														else
															setSelectedExercises.filter(
																(item) => item.name !== exercise.id,
															);
													}}
												/>
											) : null}
											<Indicator
												disabled={!exercise.numTimesInteracted}
												label={exercise.numTimesInteracted ?? ""}
												position="top-start"
												size={16}
												offset={8}
												color="grape"
											>
												<Avatar
													imageProps={{ loading: "lazy" }}
													src={exercise.image}
													radius="xl"
													size="lg"
												/>
											</Indicator>
											<Link
												to={$path("/fitness/exercises/item/:id", {
													id: encodeURIComponent(exercise.id),
												})}
												style={{ all: "unset", cursor: "pointer" }}
											>
												<Flex direction="column" justify="space-around">
													<Text>{exercise.id}</Text>
													<Flex>
														{exercise.muscle ? (
															<Text size="xs">
																{startCase(snakeCase(exercise.muscle))}
															</Text>
														) : null}
														{exercise.lastUpdatedOn ? (
															<Text size="xs" c="dimmed">
																{exercise.muscle ? "," : null}{" "}
																{dayjsLib(exercise.lastUpdatedOn).format(
																	"D MMM",
																)}
															</Text>
														) : null}
													</Flex>
												</Flex>
											</Link>
										</Flex>
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
								total={Math.ceil(
									loaderData.exercisesList.details.total /
										coreDetails.pageLimit,
								)}
							/>
						</Center>
					</>
				)}
			</Stack>
			{currentWorkout && loaderData.workoutInProgress ? (
				<Affix position={{ bottom: rem(40), right: rem(30) }}>
					<ActionIcon
						color="blue"
						variant="light"
						radius="xl"
						size="xl"
						disabled={selectedExercises.length === 0}
						onClick={async () => {
							await addExerciseToWorkout(
								currentWorkout,
								setCurrentWorkout,
								selectedExercises,
								navigate,
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
					.filter((f) => f !== "sortBy" && f !== "order" && f !== "collection")
					.map((f) => (
						<Select
							key={f}
							clearable
							// biome-ignore lint/suspicious/noExplicitAny: required here
							data={(loaderData.exerciseParameters.filters as any)[f].map(
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
