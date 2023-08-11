import type { NextPageWithLayout } from "../../_app";
import { LIMIT } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Center,
	Container,
	Flex,
	Grid as MantineGrid,
	Pagination,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useDebouncedState, useLocalStorage } from "@mantine/hooks";
import { ExercisesListDocument } from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement, useEffect } from "react";

const Page: NextPageWithLayout = () => {
	const [activePage, setPage] = useLocalStorage({
		key: "savedExercisesPage",
	});
	const [query, setQuery] = useLocalStorage({
		key: "savedExercisesQuery",
		getInitialValueInEffect: false,
	});
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(query, 1000);

	const exercisesList = useQuery({
		queryKey: ["exercisesList", activePage, debouncedQuery],
		queryFn: async () => {
			const { exercisesList } = await gqlClient.request(ExercisesListDocument, {
				input: {
					page: parseInt(activePage) || 1,
					query: debouncedQuery || undefined,
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

	const ClearButton = () =>
		query ? (
			<ActionIcon onClick={() => setQuery("")}>
				<IconX size="1rem" />
			</ActionIcon>
		) : null;

	return (
		<>
			<Head>
				<title>Exercises | Ryot</title>
			</Head>
			<Container size={"lg"}>
				<Stack spacing={"xl"}>
					<MantineGrid grow>
						<MantineGrid.Col span={12}>
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
						</MantineGrid.Col>
					</MantineGrid>
					{exercisesList.data && exercisesList.data.total > 0 ? (
						<>
							<Box>
								<Text display={"inline"} fw="bold">
									{exercisesList.data.total}
								</Text>{" "}
								items found
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
										<Avatar
											imageProps={{ loading: "lazy" }}
											src={exercise.attributes.images.at(0)}
											radius={"xl"}
											size="lg"
										/>
										<Flex direction={"column"} justify={"space-around"}>
											<Text>{exercise.name}</Text>
											<Text size="xs">
												{startCase(exercise.attributes.primaryMuscles.at(0))}
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
					) : (
						<Text>
							It looks like you have not downloaded the exercises. Please follow
							the{" "}
							<Anchor
								href="https://ignisda.github.io/ryot/guides/fitness.html"
								target="_blank"
							>
								guide
							</Anchor>{" "}
							to do so.
						</Text>
					)}
				</Stack>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
