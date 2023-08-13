import type { NextPageWithLayout } from "../../_app";
import { APP_ROUTES } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { type Exercise, currentWorkoutAtom } from "@/lib/state";
import {
	ActionIcon,
	Box,
	Button,
	Container,
	Flex,
	Menu,
	Paper,
	Skeleton,
	Stack,
	Text,
	TextInput,
	Textarea,
} from "@mantine/core";
import { ExerciseDocument } from "@ryot/generated/graphql/backend/graphql";
import {
	IconClipboard,
	IconDotsVertical,
	IconTrash,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { useAtom } from "jotai";
import { RESET } from "jotai/utils";
import { DateTime, Duration } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import { useStopwatch } from "react-timer-hook";
import { withQuery } from "ufo";

const StatDisplay = (props: { name: string; value: string }) => {
	return (
		<Box mx="auto">
			<Text color="dimmed" size="sm">
				{props.name}
			</Text>
			<Text align="center" size="xl">
				{props.value}
			</Text>
		</Box>
	);
};

const offsetDate = (startTime: string) => {
	const now = DateTime.now();
	const duration = now.diff(DateTime.fromISO(startTime));
	return now.plus(duration).toJSDate();
};

const DurationTimer = ({ startTime }: { startTime: string }) => {
	const { totalSeconds } = useStopwatch({
		autoStart: true,
		offsetTimestamp: offsetDate(startTime),
	});

	return (
		<StatDisplay
			name="Duration"
			value={Duration.fromObject({ seconds: totalSeconds }).toFormat("mm:ss")}
		/>
	);
};

const ExerciseDisplay = (props: { idx: number; exercise: Exercise }) => {
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	const exerciseDetails = useQuery(
		["exercise", props.exercise.exerciseId],
		async () => {
			const { exercise } = await gqlClient.request(ExerciseDocument, {
				exerciseId: props.exercise.exerciseId,
			});
			return exercise;
		},
	);

	return exerciseDetails.data && currentWorkout ? (
		<Paper withBorder p="xs">
			<Menu shadow="md" width={200}>
				<Stack>
					<Flex justify={"space-between"}>
						<Text>{exerciseDetails.data.name}</Text>
						<Menu.Target>
							<ActionIcon color="blue">
								<IconDotsVertical />
							</ActionIcon>
						</Menu.Target>
					</Flex>
					{currentWorkout.exercises[props.idx].notes.map((n, idx) => (
						<Flex key={idx} align={"center"} gap="xs">
							<Textarea
								style={{ flexGrow: 1 }}
								size="xs"
								maxRows={1}
								autosize
								value={n}
								onChange={(e) => {
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											draft.exercises[props.idx].notes[idx] =
												e.currentTarget.value;
										}),
									);
								}}
							/>
							<ActionIcon
								color="red"
								onClick={() => {
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											draft.exercises[props.idx].notes.splice(idx, 1);
										}),
									);
								}}
							>
								<IconTrash />
							</ActionIcon>
						</Flex>
					))}
				</Stack>
				<Menu.Dropdown>
					<Menu.Item
						icon={<IconClipboard size={14} />}
						onClick={() => {
							setCurrentWorkout(
								produce(currentWorkout, (draft) => {
									draft.exercises[props.idx].notes.push("");
								}),
							);
						}}
					>
						Add note
					</Menu.Item>
					<Menu.Item
						color="red"
						icon={<IconTrash size={14} />}
						onClick={() => {
							const yes = confirm(
								`This removes '${exerciseDetails.data.name}' and all its sets from your workout. You can not undo this action. Are you sure you want to continue?`,
							);
							if (yes)
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										draft.exercises.splice(props.idx, 1);
									}),
								);
						}}
					>
						Remove exercise
					</Menu.Item>
				</Menu.Dropdown>
			</Menu>
		</Paper>
	) : (
		<Skeleton height={20} radius="xl" />
	);
};

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	return (
		<>
			<Head>
				<title>Workout in progress | Ryot</title>
			</Head>
			<Container size="sm">
				{currentWorkout ? (
					<Stack>
						<Flex align="end">
							<TextInput
								size="sm"
								label="Name"
								placeholder="A name for your workout"
								value={currentWorkout.name}
								onChange={(e) =>
									setCurrentWorkout(
										produce(currentWorkout, (draft) => {
											draft.name = e.currentTarget.value;
										}),
									)
								}
							/>
							<DurationTimer startTime={currentWorkout.startTime} />
							{/*
								<StatDisplay
									name="Exercises"
									value={currentWorkout.exercises.length.toString()}
								/>
							*/}
						</Flex>
						{currentWorkout.exercises.map((ex, idx) => (
							<ExerciseDisplay key={idx} exercise={ex} idx={idx} />
						))}
						<Textarea
							size="sm"
							label="Comment"
							placeholder="Your thoughts about this workout"
							value={currentWorkout.comment}
							onChange={(e) =>
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										draft.comment = e.currentTarget.value;
									}),
								)
							}
						/>
						<Link
							passHref
							legacyBehavior
							href={withQuery(APP_ROUTES.fitness.exercises.list, {
								selectionEnabled: "yes",
							})}
						>
							<Button component="a" variant="subtle">
								Add exercise
							</Button>
						</Link>
						<Button
							color="red"
							variant="subtle"
							onClick={() => {
								setCurrentWorkout(RESET);
								router.push(APP_ROUTES.dashboard);
							}}
						>
							Finish workout
						</Button>
					</Stack>
				) : (
					<Text>
						You do not have any workout in progress. Please start a new one from
						the dashboard.
					</Text>
				)}
				{JSON.stringify(currentWorkout)}
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
