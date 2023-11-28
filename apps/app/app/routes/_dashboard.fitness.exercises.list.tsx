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
	Modal,
	Select,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
	rem,
} from "@mantine/core";
import { useDisclosure, useListState } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import {
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	ExerciseParametersDocument,
	ExerciseSortBy,
	ExercisesListDocument,
	SetLot,
	UserExerciseDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconCheck,
	IconFilter,
	IconFilterOff,
	IconPlus,
	IconSearch,
	IconX,
} from "@tabler/icons-react";
import { createDraft, finishDraft } from "immer";
import { useAtom } from "jotai";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { $path } from "remix-routes";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationPagination } from "~/components/common";
import { gqlClientSide } from "~/lib/api.client";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";
import { currentWorkoutAtom } from "~/lib/workout";

const defaultFiltersValue = {
	muscle: undefined,
	type: undefined,
	equipment: undefined,
	force: undefined,
	level: undefined,
	mechanic: undefined,
	sort: ExerciseSortBy.LastPerformed,
};

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
	sort: z.nativeEnum(ExerciseSortBy).default(defaultFiltersValue.sort),
	type: z.nativeEnum(ExerciseLot).optional(),
	level: z.nativeEnum(ExerciseLevel).optional(),
	force: z.nativeEnum(ExerciseForce).optional(),
	mechanic: z.nativeEnum(ExerciseMechanic).optional(),
	equipment: z.nativeEnum(ExerciseEquipment).optional(),
	muscle: z.nativeEnum(ExerciseMuscle).optional(),
	selectionEnabled: zx.BoolAsString.optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [
		coreDetails,
		userPreferences,
		{ exerciseParameters },
		{ exercisesList },
	] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
		gqlClient.request(ExerciseParametersDocument, {}),
		gqlClient.request(
			ExercisesListDocument,
			{
				input: {
					search: {
						page: query.page,
						query: query.query,
					},
					filter: {
						equipment: query.equipment,
						force: query.force,
						level: query.level,
						mechanic: query.mechanic,
						muscle: query.muscle,
						type: query.type,
					},
					sortBy: query.sort,
				},
			},
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		coreDetails,
		userPreferences,
		query,
		exerciseParameters,
		exercisesList,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Exercises | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const [searchParams, { setP }] = useSearchParam();
	const [selectedExercises, setSelectedExercises] = useListState<{
		name: string;
		lot: ExerciseLot;
	}>([]);
	const [query, setQuery] = useState(searchParams.get("query") || "");
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	useEffect(() => setP("query", query), [query]);

	const isFilterChanged = Object.keys(defaultFiltersValue)
		.filter((k) => k !== "page" && k !== "query" && k !== "selectionEnabled")
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
						to={$path("/fitness/exercises/create-or-edit")}
					>
						<IconPlus size={16} />
					</ActionIcon>
				</Flex>
				{loaderData.exerciseParameters.downloadRequired ? (
					<Alert
						icon={<IconAlertCircle size={16} />}
						variant="outline"
						color="violet"
					>
						Please follow the{" "}
						<Anchor
							href="https://ignisda.github.io/ryot/guides/fitness.html"
							target="_blank"
						>
							fitness guide
						</Anchor>{" "}
						to download the exercise dataset.
					</Alert>
				) : (
					<>
						<Group wrap="nowrap">
							<TextInput
								name="query"
								placeholder="Search for exercises by name or instructions"
								leftSection={<IconSearch />}
								onChange={(e) => setQuery(e.currentTarget.value)}
								value={query}
								rightSection={
									query ? (
										<ActionIcon onClick={() => setQuery("")}>
											<IconX size={16} />
										</ActionIcon>
									) : undefined
								}
								style={{ flexGrow: 1 }}
								autoCapitalize="none"
								autoComplete="off"
							/>
							<ActionIcon
								onClick={openFiltersModal}
								color={isFilterChanged ? "blue" : "gray"}
							>
								<IconFilter size={24} />
							</ActionIcon>
							<Modal
								opened={filtersModalOpened}
								onClose={closeFiltersModal}
								centered
								withCloseButton={false}
							>
								<MantineThemeProvider
									theme={{
										components: {
											Select: Select.extend({ defaultProps: { size: "xs" } }),
										},
									}}
								>
									<Stack gap={4}>
										<Group>
											<Title order={3}>Filters</Title>
											<ActionIcon
												onClick={() => {
													navigate(".");
													closeFiltersModal();
												}}
											>
												<IconFilterOff size={24} />
											</ActionIcon>
										</Group>
										<Select
											clearable
											data={Object.values(ExerciseSortBy).map((v) => ({
												label: startCase(snakeCase(v)),
												value: v,
											}))}
											label="Sort by"
											defaultValue={loaderData.query.sort}
											onChange={(v) => setP("sortBy", v)}
										/>
										{Object.keys(defaultFiltersValue)
											.filter((f) => f !== "sort" && f !== "order")
											.map((f) => (
												<Select
													key={f}
													clearable
													// biome-ignore lint/suspicious/noExplicitAny: required here
													data={(loaderData.exerciseParameters.filters as any)[
														f
													].map(
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
									</Stack>
								</MantineThemeProvider>
							</Modal>
						</Group>
						{loaderData.exercisesList.details.total > 0 ? (
							<>
								<Box>
									<Text display="inline" fw="bold">
										{loaderData.exercisesList.details.total}
									</Text>{" "}
									items found
									{loaderData.query.selectionEnabled ? (
										<>
											{" "}
											and{" "}
											<Text display="inline" fw="bold">
												{selectedExercises.length}
											</Text>{" "}
											selected
										</>
									) : undefined}
								</Box>
								<SimpleGrid cols={{ md: 2, lg: 3 }}>
									{loaderData.exercisesList.items.map((exercise) => (
										<Flex
											key={exercise.id}
											gap="lg"
											align="center"
											data-exercise-id={exercise.id}
										>
											{loaderData.query.selectionEnabled ? (
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
											) : undefined}
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
												to={$path("/fitness/exercises/:id", {
													id: exercise.id,
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
														) : undefined}
														{exercise.lastUpdatedOn ? (
															<Text size="xs" c="dimmed">
																{exercise.muscle ? "," : undefined}{" "}
																{DateTime.fromISO(
																	exercise.lastUpdatedOn,
																).toFormat("d LLL")}
															</Text>
														) : undefined}
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
						{loaderData.exercisesList.details.total > 0 ? (
							<Center>
								<ApplicationPagination
									size="sm"
									defaultValue={loaderData.query.page}
									onChange={(v) => setP("page", v.toString())}
									total={Math.ceil(
										loaderData.exercisesList.details.total /
											loaderData.coreDetails.pageLimit,
									)}
								/>
							</Center>
						) : undefined}
					</>
				)}
			</Stack>
			{currentWorkout && selectedExercises.length >= 1 ? (
				<Affix position={{ bottom: rem(40), right: rem(30) }}>
					<ActionIcon
						color="blue"
						variant="light"
						radius="xl"
						size="xl"
						onClick={async () => {
							const draft = createDraft(currentWorkout);
							for (const exercise of selectedExercises) {
								const { userExerciseDetails } = await gqlClientSide.request(
									UserExerciseDetailsDocument,
									{ input: { exerciseId: exercise.name, takeHistory: 1 } },
								);
								draft.exercises.push({
									exerciseId: exercise.name,
									lot: exercise.lot,
									name: exercise.name,
									sets: [
										{
											confirmed: false,
											statistic: {},
											lot: SetLot.Normal,
										},
									],
									alreadyDoneSets:
										userExerciseDetails?.history?.at(0)?.sets.map((s) => ({
											// biome-ignore lint/suspicious/noExplicitAny: required here
											statistic: s.statistic as any,
										})) || [],
									restTimer: loaderData.userPreferences.fitness.exercises
										.defaultTimer
										? {
												duration:
													loaderData.userPreferences.fitness.exercises
														.defaultTimer,
												enabled: true,
										  }
										: undefined,
									notes: [],
									images: [],
									videos: [],
								});
							}
							const finishedDraft = finishDraft(draft);
							setCurrentWorkout(finishedDraft);
							navigate($path("/fitness/exercises/current-workout"));
						}}
					>
						<IconCheck size={32} />
					</ActionIcon>
					{/* TODO: Add btn to add superset exercises */}
				</Affix>
			) : undefined}
		</Container>
	);
}
