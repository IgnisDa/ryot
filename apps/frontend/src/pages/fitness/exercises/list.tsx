import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { currentWorkoutAtom } from "@/lib/state";
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
	Pagination,
	Select,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
	rem,
} from "@mantine/core";
import {
	useDebouncedState,
	useDisclosure,
	useListState,
	useLocalStorage,
} from "@mantine/hooks";
import {
	type ExerciseListFilter,
	ExerciseLot,
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
	IconRefresh,
	IconSearch,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createDraft, finishDraft, produce } from "immer";
import { useAtom } from "jotai";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

const defaultFilterValue = {
	muscle: undefined,
	type: undefined,
	equipment: undefined,
	force: undefined,
	level: undefined,
	mechanic: undefined,
} as ExerciseListFilter;

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const selectionEnabled = !!router.query.selectionEnabled;
	const coreDetails = useCoreDetails();

	const [selectedExercises, setSelectedExercises] = useListState<{
		name: string;
		id: number;
		lot: ExerciseLot;
	}>([]);
	const [activePage, setPage] = useLocalStorage({
		defaultValue: "1",
		key: LOCAL_STORAGE_KEYS.savedExercisesPage,
	});
	const [query, setQuery] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedExercisesQuery,
		getInitialValueInEffect: false,
	});
	const [exerciseFilters, setExerciseFilters] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedExerciseFilters,
		defaultValue: defaultFilterValue,
		getInitialValueInEffect: true,
	});
	const [exerciseSortBy, setExerciseSortBy] = useLocalStorage<ExerciseSortBy>({
		key: LOCAL_STORAGE_KEYS.savedExerciseSortBy,
		defaultValue: ExerciseSortBy.NumTimesPerformed,
		getInitialValueInEffect: true,
	});
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(query, 1000);
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	const exerciseInformation = useQuery({
		queryKey: ["exerciseInformation"],
		queryFn: async () => {
			const { exerciseParameters } = await gqlClient.request(
				ExerciseParametersDocument,
				{},
			);
			return exerciseParameters;
		},
		staleTime: Infinity,
	});
	const exercisesList = useQuery({
		queryKey: [
			"exercisesList",
			activePage,
			debouncedQuery,
			exerciseFilters,
			exerciseSortBy,
		],
		queryFn: async () => {
			const { exercisesList } = await gqlClient.request(ExercisesListDocument, {
				input: {
					search: {
						page: parseInt(activePage || "1"),
						query: debouncedQuery || undefined,
					},
					filter: exerciseFilters,
					sortBy: exerciseSortBy,
				},
			});
			return exercisesList;
		},
		staleTime: Infinity,
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim());
	}, [query]);

	const isFilterChanged =
		Object.values(exerciseFilters || {}).filter(Boolean).length > 0;

	const resetFilters = () => {
		setExerciseFilters(defaultFilterValue);
	};

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size={16} />
			</ActionIcon>
		) : undefined;

	return coreDetails.data && exerciseInformation.data ? (
		<>
			<Head>
				<title>Exercises | Ryot</title>
			</Head>
			<Container size="md">
				<Stack gap="xl">
					<Flex align="center" gap="md">
						<Title>Exercises</Title>
						<ActionIcon
							color="green"
							component={Link}
							variant="outline"
							href={APP_ROUTES.fitness.exercises.createOrEdit}
						>
							<IconPlus size={16} />
						</ActionIcon>
					</Flex>
					{exerciseInformation.data.downloadRequired ? (
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
									rightSection={<ClearButton />}
									style={{ flexGrow: 1 }}
									autoCapitalize="none"
									autoComplete="off"
								/>
								<ActionIcon
									size="lg"
									loading={exercisesList.isLoading}
									onClick={() => exercisesList.refetch()}
								>
									<IconRefresh size={26} />
								</ActionIcon>
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
												<ActionIcon onClick={resetFilters}>
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
												value={exerciseSortBy}
												onChange={(v) => {
													if (v)
														// biome-ignore lint/suspicious/noExplicitAny: required heres
														setExerciseSortBy(v as any);
												}}
											/>
											{Object.keys(defaultFilterValue)
												.filter((f) => f !== "sortBy")
												.map((f) => (
													<Select
														key={f}
														clearable
														// biome-ignore lint/suspicious/noExplicitAny: required heres
														data={(exerciseInformation.data.filters as any)[
															f
														].map(
															// biome-ignore lint/suspicious/noExplicitAny: required heres
															(v: any) => ({
																label: startCase(snakeCase(v)),
																value: v,
															}),
														)}
														label={startCase(f)}
														// biome-ignore lint/suspicious/noExplicitAny: required heres
														value={(exerciseFilters as any)[f]}
														onChange={(v) => {
															if (exerciseFilters)
																setExerciseFilters(
																	produce(exerciseFilters, (draft) => {
																		// biome-ignore lint/suspicious/noExplicitAny: required heres
																		(draft as any)[f] = v;
																	}),
																);
														}}
													/>
												))}
										</Stack>
									</MantineThemeProvider>
								</Modal>
							</Group>
							{exercisesList.data && exercisesList.data.details.total > 0 ? (
								<>
									<Box>
										<Text display="inline" fw="bold">
											{exercisesList.data.details.total}
										</Text>{" "}
										items found
										{selectionEnabled ? (
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
										{exercisesList.data.items.map((exercise) => (
											<Flex
												key={exercise.id}
												gap="lg"
												align="center"
												data-exercise-id={exercise.id}
											>
												{selectionEnabled ? (
													<Checkbox
														onChange={(e) => {
															if (e.currentTarget.checked)
																setSelectedExercises.append({
																	name: exercise.name,
																	id: exercise.id,
																	lot: exercise.lot,
																});
															else
																setSelectedExercises.filter(
																	(item) => item.id !== exercise.id,
																);
														}}
													/>
												) : undefined}
												<Indicator
													disabled={!exercise.numTimesPerformed}
													label={exercise.numTimesPerformed ?? ""}
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
													href={withQuery(
														APP_ROUTES.fitness.exercises.details,
														{ id: exercise.id },
													)}
													style={{ all: "unset", cursor: "pointer" }}
												>
													<Flex direction="column" justify="space-around">
														<Text>{exercise.name}</Text>
														{exercise.muscle ? (
															<Text size="xs">
																{startCase(snakeCase(exercise.muscle))}
															</Text>
														) : undefined}
													</Flex>
												</Link>
											</Flex>
										))}
									</SimpleGrid>
								</>
							) : (
								<Text>No information to display</Text>
							)}
							{exercisesList.data && exercisesList.data.details.total > 0 ? (
								<Center>
									<Pagination
										size="sm"
										value={parseInt(activePage || "1")}
										onChange={(v) => setPage(v.toString())}
										total={Math.ceil(
											exercisesList.data.details.total /
												coreDetails.data.pageLimit,
										)}
										boundaries={1}
										siblings={0}
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
									const { userExerciseDetails } = await gqlClient.request(
										UserExerciseDetailsDocument,
										{ input: { exerciseId: exercise.id, takeHistory: 1 } },
									);
									draft.exercises.push({
										exerciseId: exercise.id,
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
											userExerciseDetails?.history
												.at(-1)
												?.sets.map((s) => ({ statistic: s.statistic })) || [],
										notes: [],
										images: [],
										videos: [],
									});
								}
								const finishedDraft = finishDraft(draft);
								setCurrentWorkout(finishedDraft);
								router.replace(APP_ROUTES.fitness.exercises.currentWorkout);
							}}
						>
							<IconCheck size={32} />
						</ActionIcon>
						{/* TODO: Add btn to add superset exercises */}
					</Affix>
				) : undefined}
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
