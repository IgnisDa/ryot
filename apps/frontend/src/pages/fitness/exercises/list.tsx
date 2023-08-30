import { APP_ROUTES } from "@/lib/constants";
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
	ExercisesListDocument,
	SetLot,
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
			const { exerciseParameters } = await gqlClient.request(
				ExerciseParametersDocument,
				{},
			);
			return exerciseParameters;
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
		) : undefined;

	return coreDetails.data && exerciseInformation.data ? (
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
							<Flex align="center" gap="md">
								<TextInput
									name="query"
									placeholder="Search for exercises by name or instructions"
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
							{exercisesList.data && exercisesList.data.details.total > 0 ? (
								<>
									<Box>
										<Text display={"inline"} fw="bold">
											{exercisesList.data.details.total}
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
										) : undefined}
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
												<Avatar
													imageProps={{ loading: "lazy" }}
													src={exercise.attributes.images.at(0)}
													radius={"xl"}
													size="lg"
												/>
												<Link
													href={withQuery(
														APP_ROUTES.fitness.exercises.details,
														{ id: exercise.id },
													)}
													style={{ all: "unset", cursor: "pointer" }}
												>
													<Flex direction={"column"} justify={"space-around"}>
														<Text>{exercise.name}</Text>
														{exercise.attributes.muscles.at(0) ? (
															<Text size="xs">
																{startCase(
																	snakeCase(exercise.attributes.muscles.at(0)),
																)}
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
										value={parseInt(activePage)}
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
							onClick={() => {
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										for (const exercise of selectedExercises)
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
												notes: [],
											});
									}),
								);
								router.replace(APP_ROUTES.fitness.exercises.currentWorkout);
							}}
						>
							<IconCheck size="1.6rem" />
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
