import type { NextPageWithLayout } from "../../_app";
import { APP_ROUTES, LIMIT } from "@/lib/constants";
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
	ExerciseInformationDocument,
	type ExerciseListFilter,
	ExercisesListDocument,
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
import { useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { useAtom } from "jotai";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useEffect } from "react";

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

	const [selectedExercises, setSelectedExercises] = useListState<number>([]);
	const [activePage, setPage] = useLocalStorage({
		key: "savedExercisesPage",
	});
	const [query, setQuery] = useLocalStorage({
		key: "savedExercisesQuery",
		getInitialValueInEffect: false,
	});
	const [exerciseFilters, setExerciseFilters] = useLocalStorage({
		key: "savedExerciseFilters",
		defaultValue: defaultFilterValue,
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
			const { exerciseInformation } = await gqlClient.request(
				ExerciseInformationDocument,
				{},
			);
			return exerciseInformation;
		},
		staleTime: Infinity,
	});
	const exercisesList = useQuery({
		queryKey: ["exercisesList", activePage, debouncedQuery, exerciseFilters],
		queryFn: async () => {
			const { exercisesList } = await gqlClient.request(ExercisesListDocument, {
				input: {
					page: parseInt(activePage) || 1,
					query: debouncedQuery || undefined,
					filter: exerciseFilters,
				},
			});
			return exercisesList;
		},
		onSuccess: () => {
			if (!activePage) setPage("1");
		},
		staleTime: Infinity,
	});

	useEffect(() => {
		setDebouncedQuery(query?.trim());
	}, [query]);

	const isFilterChanged =
		Object.values(exerciseFilters).filter(Boolean).length > 0;

	const resetFilters = () => {
		setExerciseFilters(defaultFilterValue);
	};

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size="1rem" />
			</ActionIcon>
		) : null;

	return exerciseInformation.data ? (
		<>
			<Head>
				<title>Exercises | Ryot</title>
			</Head>
			<Container size={"lg"}>
				<Stack spacing={"xl"}>
					<Flex align={"center"} gap={"md"}>
						<Title>Exercises</Title>
						<ActionIcon
							color="green"
							variant="outline"
							onClick={() => {
								alert("TODO: Create an exercise.");
							}}
						>
							<IconPlus size="1rem" />
						</ActionIcon>
					</Flex>
					{exerciseInformation.data.downloadRequired ? (
						<Alert
							icon={<IconAlertCircle size="1rem" />}
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
							<Flex align={"center"} gap={"md"}>
								<TextInput
									name="query"
									placeholder={"Search for exercises"}
									icon={<IconSearch />}
									onChange={(e) => setQuery(e.currentTarget.value)}
									value={query}
									rightSection={<ClearButton />}
									style={{ flexGrow: 1 }}
									autoCapitalize="none"
									autoComplete="off"
								/>
								<ActionIcon
									onClick={openFiltersModal}
									color={isFilterChanged ? "blue" : undefined}
								>
									<IconFilter size="1.5rem" />
								</ActionIcon>
								<Modal
									opened={filtersModalOpened}
									onClose={closeFiltersModal}
									centered
									withCloseButton={false}
								>
									<Stack>
										<Group>
											<Title order={3}>Filters</Title>
											<ActionIcon onClick={resetFilters}>
												<IconFilterOff size="1.5rem" />
											</ActionIcon>
										</Group>
										{Object.keys(defaultFilterValue).map((f, idx) => (
											<Select
												key={idx}
												withinPortal
												clearable
												data={(exerciseInformation.data.filters as any)[f].map(
													(v: any) => ({
														label: startCase(snakeCase(v)),
														value: v,
													}),
												)}
												label={startCase(f)}
												value={(exerciseFilters as any)[f]}
												onChange={(v) => {
													setExerciseFilters(
														produce(exerciseFilters, (draft) => {
															(draft as any)[f] = v;
														}),
													);
												}}
											/>
										))}
									</Stack>
								</Modal>
							</Flex>
							{exercisesList.data && exercisesList.data.total > 0 ? (
								<>
									<Box>
										<Text display={"inline"} fw="bold">
											{exercisesList.data.total}
										</Text>{" "}
										items found
										{selectionEnabled ? (
											<>
												{" "}
												and{" "}
												<Text display={"inline"} fw="bold">
													{selectedExercises.length}
												</Text>{" "}
												selected
											</>
										) : null}
									</Box>
									<SimpleGrid
										breakpoints={[
											{ minWidth: "md", cols: 2 },
											{ minWidth: "lg", cols: 3 },
										]}
									>
										{exercisesList.data.items.map((exercise) => (
											<Flex
												key={exercise.id}
												gap="lg"
												align={"center"}
												data-exercise-id={exercise.id}
											>
												{selectionEnabled ? (
													<Checkbox
														onChange={(e) => {
															if (e.currentTarget.checked)
																setSelectedExercises.append(exercise.id);
															else
																setSelectedExercises.filter(
																	(item) => item !== exercise.id,
																);
														}}
													/>
												) : null}
												<Avatar
													imageProps={{ loading: "lazy" }}
													src={exercise.attributes.images.at(0)}
													radius={"xl"}
													size="lg"
												/>
												<Flex direction={"column"} justify={"space-around"}>
													<Text>{exercise.name}</Text>
													<Text size="xs">
														{startCase(
															snakeCase(
																exercise.attributes.primaryMuscles.at(0),
															),
														)}
													</Text>
												</Flex>
											</Flex>
										))}
									</SimpleGrid>
								</>
							) : (
								<Text>No information to display</Text>
							)}
							{exercisesList.data && exercisesList.data.total > 0 ? (
								<Center>
									<Pagination
										size="sm"
										value={parseInt(activePage)}
										onChange={(v) => setPage(v.toString())}
										total={Math.ceil(exercisesList.data.total / LIMIT)}
										boundaries={1}
										siblings={0}
									/>
								</Center>
							) : null}
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
							onClick={() => {
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										for (const exerciseId of selectedExercises)
											draft.exercises.push({
												exerciseId: exerciseId,
												sets: [{ idx: 0 }],
												notes: [],
											});
									}),
								);
								router.push(APP_ROUTES.fitness.exercises.inProgress);
							}}
						>
							<IconCheck size="1.6rem" />
						</ActionIcon>
						{/* TODO: Add btn to add superset exercises */}
					</Affix>
				) : null}
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
