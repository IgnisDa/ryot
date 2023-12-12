import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Badge,
	Box,
	Button,
	Container,
	Flex,
	Group,
	Menu,
	Modal,
	Paper,
	Popover,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import "@mantine/dates/styles.css";
import { useDisclosure } from "@mantine/hooks";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigate } from "@remix-run/react";
import {
	DeleteUserWorkoutDocument,
	EditUserWorkoutDocument,
	ExerciseLot,
	SetLot,
	WorkoutDetailsDocument,
	WorkoutDetailsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	displayWeightWithUnit,
	humanizeDuration,
	startCase,
} from "@ryot/ts-utils";
import {
	IconClock,
	IconClockEdit,
	IconDotsVertical,
	IconInfoCircle,
	IconRepeat,
	IconRotateClockwise,
	IconRun,
	IconTrash,
	IconTrophy,
	IconWeight,
	IconZzz,
} from "@tabler/icons-react";
import { useAtom } from "jotai";
import { namedAction } from "remix-utils/named-action";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { DisplayExerciseStats } from "~/components/fitness";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { dayjsLib, getSetColor } from "~/lib/generals";
import { getUserPreferences } from "~/lib/graphql.server";
import { useGetMantineColor } from "~/lib/hooks";
import { createToastHeaders, redirectWithToast } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";
import {
	currentWorkoutAtom,
	duplicateOldWorkout,
	startWorkout,
} from "~/lib/workout";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const workoutId = params.id;
	invariant(workoutId, "No ID provided");
	const [userPreferences, { workoutDetails }] = await Promise.all([
		getUserPreferences(request),
		gqlClient.request(
			WorkoutDetailsDocument,
			{ workoutId },
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		workoutId,
		userPreferences: {
			unitSystem: userPreferences.fitness.exercises.unitSystem,
		},
		workoutDetails,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).workoutDetails.name
			} | Ryot`,
		},
	];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		edit: async () => {
			const submission = processSubmission(formData, editWorkoutSchema);
			await gqlClient.request(
				EditUserWorkoutDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Workout edited successfully",
				}),
			});
		},
		delete: async () => {
			const submission = processSubmission(formData, deleteSchema);
			await gqlClient.request(
				DeleteUserWorkoutDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return redirectWithToast($path("/fitness/workouts/list"), {
				message: "Workout deleted successfully",
			});
		},
	});
};

const deleteSchema = z.object({ workoutId: z.string() });

const editWorkoutSchema = z.object({
	startTime: z.string(),
	endTime: z.string(),
	id: z.string(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, setCurrentWorkout] = useAtom(currentWorkoutAtom);
	const [
		adjustTimeModalOpened,
		{ open: adjustTimeModalOpen, close: adjustTimeModalClose },
	] = useDisclosure(false);
	const navigate = useNavigate();

	return (
		<>
			<Modal
				opened={adjustTimeModalOpened}
				onClose={adjustTimeModalClose}
				withCloseButton={false}
				centered
			>
				<Box component={Form} action="?intent=edit" method="post">
					<Stack>
						<Title order={3}>Adjust times</Title>
						<DateTimePicker
							label="Start time"
							required
							name="startTime"
							defaultValue={new Date(loaderData.workoutDetails.startTime)}
						/>
						<DateTimePicker
							label="End time"
							required
							name="endTime"
							defaultValue={new Date(loaderData.workoutDetails.endTime)}
						/>
						<Button
							variant="outline"
							type="submit"
							name="id"
							value={loaderData.workoutId}
						>
							Submit
						</Button>
					</Stack>
				</Box>
			</Modal>
			<Container size="xs">
				<Stack>
					<Group justify="space-between">
						<Title>{loaderData.workoutDetails.name}</Title>
						<Menu shadow="md" position="bottom-end">
							<Menu.Target>
								<ActionIcon>
									<IconDotsVertical />
								</ActionIcon>
							</Menu.Target>
							<Menu.Dropdown>
								<Menu.Item
									onClick={() => {
										setCurrentWorkout(
											duplicateOldWorkout(loaderData.workoutDetails),
										);
										startWorkout();
										navigate($path("/fitness/workouts/current"));
									}}
									leftSection={<IconRepeat size={14} />}
								>
									Repeat
								</Menu.Item>
								<Menu.Item
									onClick={adjustTimeModalOpen}
									leftSection={<IconClockEdit size={14} />}
								>
									Adjust time
								</Menu.Item>
								<Form action="?intent=delete" method="post">
									<Menu.Item
										onClick={(e) => {
											if (
												!confirm(
													"Are you sure you want to delete this workout? This action is not reversible.",
												)
											)
												e.preventDefault();
										}}
										color="red"
										leftSection={<IconTrash size={14} />}
										type="submit"
										value={loaderData.workoutId}
										name="workoutId"
									>
										Delete
									</Menu.Item>
								</Form>
							</Menu.Dropdown>
						</Menu>
					</Group>
					<Box>
						<Text c="dimmed" span>
							Done on{" "}
						</Text>
						<Text span>
							{dayjsLib(loaderData.workoutDetails.startTime).format("LLL")}
						</Text>
						<Group mt="xs" gap="lg">
							<DisplayStat
								icon={<IconClock size={16} />}
								data={humanizeDuration(
									new Date(loaderData.workoutDetails.endTime).getTime() -
										new Date(loaderData.workoutDetails.startTime).getTime(),
									{ round: true, units: ["h", "m"] },
								)}
							/>
							<DisplayStat
								icon={<IconWeight size={16} />}
								data={displayWeightWithUnit(
									loaderData.userPreferences.unitSystem,
									loaderData.workoutDetails.summary.total.weight,
								)}
							/>
							<DisplayStat
								icon={<IconTrophy size={16} />}
								data={`${loaderData.workoutDetails.summary.total.personalBestsAchieved.toString()} PRs`}
							/>
							{loaderData.workoutDetails.summary.total.restTime > 0 ? (
								<DisplayStat
									icon={<IconZzz size={16} />}
									data={humanizeDuration(
										loaderData.workoutDetails.summary.total.restTime * 1e3,
										{ round: true, units: ["m", "s"] },
									)}
								/>
							) : undefined}
						</Group>
					</Box>
					{loaderData.workoutDetails.comment ? (
						<Box>
							<Text c="dimmed" span>
								Commented:{" "}
							</Text>
							<Text span>{loaderData.workoutDetails.comment}</Text>
						</Box>
					) : undefined}
					{loaderData.workoutDetails.information.exercises.length > 0 ? (
						loaderData.workoutDetails.information.exercises.map(
							(exercise, idx) => (
								<DisplayExercise
									key={`${exercise.id}-${idx}`}
									exercise={exercise}
									idx={idx}
								/>
							),
						)
					) : (
						<Paper withBorder p="xs">
							No exercises done
						</Paper>
					)}
				</Stack>
			</Container>
		</>
	);
}

type Exercise =
	WorkoutDetailsQuery["workoutDetails"]["information"]["exercises"][number];

const DisplayExercise = (props: { exercise: Exercise; idx: number }) => {
	const loaderData = useLoaderData<typeof loader>();
	const [opened, { close, open }] = useDisclosure(false);

	return (
		<Paper withBorder p="xs">
			<Box mb="xs">
				<Group justify="space-between">
					<Anchor
						component={Link}
						to={$path("/fitness/exercises/:id", {
							id: props.exercise.id,
						})}
						fw="bold"
					>
						{props.exercise.id.slice(0, 40)}
						{props.exercise.id.length > 40 ? "..." : undefined}
					</Anchor>
					<Popover position="top" opened={opened}>
						<Popover.Target>
							<ActionIcon
								onMouseEnter={open}
								onMouseLeave={close}
								variant="transparent"
							>
								<IconInfoCircle size={18} />
							</ActionIcon>
						</Popover.Target>
						<Popover.Dropdown style={{ pointerEvents: "none" }} p={4}>
							<Stack gap={4}>
								{props.exercise.restTime ? (
									<Flex align="center" gap="xs">
										<IconZzz size={14} />
										<Text fz="xs">Rest time: {props.exercise.restTime}s</Text>
									</Flex>
								) : undefined}
								{Number(props.exercise.total.reps) > 0 ? (
									<Flex align="center" gap="xs">
										<IconRotateClockwise size={14} />
										<Text fz="xs">Reps: {props.exercise.total.reps}</Text>
									</Flex>
								) : undefined}
								{Number(props.exercise.total.duration) > 0 ? (
									<Flex align="center" gap="xs">
										<IconClock size={14} />
										<Text fz="xs">
											Duration: {props.exercise.total.duration} min
										</Text>
									</Flex>
								) : undefined}
								{Number(props.exercise.total.weight) > 0 ? (
									<Flex align="center" gap="xs">
										<IconWeight size={14} />
										<Text fz="xs">
											Weight:{" "}
											{displayWeightWithUnit(
												loaderData.userPreferences.unitSystem,
												props.exercise.total.weight,
											)}
										</Text>
									</Flex>
								) : undefined}{" "}
								{Number(props.exercise.total.distance) > 0 ? (
									<Flex align="center" gap="xs">
										<IconRun size={14} />
										<Text fz="xs">
											Distance: {props.exercise.total.distance}
										</Text>
									</Flex>
								) : undefined}
							</Stack>
						</Popover.Dropdown>
					</Popover>
				</Group>
				{props.exercise.notes.map((n, idxN) => (
					<Text c="dimmed" key={n} size="xs">
						{props.exercise.notes.length === 1 ? undefined : `${idxN + 1})`} {n}
					</Text>
				))}
				{props.exercise.assets.images.length > 0 ? (
					<Avatar.Group>
						{props.exercise.assets.images.map((i) => (
							<Anchor
								key={i}
								href={i}
								target="_blank"
								rel="noopener noreferrer"
							>
								<Avatar src={i} />
							</Anchor>
						))}
					</Avatar.Group>
				) : undefined}
			</Box>
			{props.exercise.sets.map((s, idx) => (
				<DisplaySet
					key={`${idx}`}
					set={s}
					idx={idx}
					exerciseLot={props.exercise.lot}
				/>
			))}
		</Paper>
	);
};

type Set = Exercise["sets"][number];

const DisplaySet = (props: {
	set: Set;
	idx: number;
	exerciseLot: ExerciseLot;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const getMantineColor = useGetMantineColor();
	const [opened, { close, open }] = useDisclosure(false);

	return (
		<Box key={`${props.idx}`} mb={2}>
			<Flex align="center">
				<Text
					fz="sm"
					c={getSetColor(props.set.lot)}
					mr="md"
					fw="bold"
					ff="monospace"
				>
					{match(props.set.lot)
						.with(SetLot.Normal, () => props.idx + 1)
						.otherwise(() => props.set.lot.at(0))}
				</Text>
				{props.set.personalBests.length > 0 ? (
					<Popover position="left" withArrow shadow="md" opened={opened}>
						<Popover.Target>
							<ActionIcon
								onMouseEnter={open}
								onMouseLeave={close}
								variant="transparent"
								color="grape"
							>
								<IconTrophy size={18} />
							</ActionIcon>
						</Popover.Target>
						<Popover.Dropdown style={{ pointerEvents: "none" }} p={4}>
							<Flex>
								{props.set.personalBests.map((pb) => (
									<Badge
										key={pb}
										variant="light"
										size="xs"
										color={getMantineColor(pb)}
									>
										{startCase(pb)}
									</Badge>
								))}
							</Flex>
						</Popover.Dropdown>
					</Popover>
				) : undefined}
				<DisplayExerciseStats
					lot={props.exerciseLot}
					statistic={props.set.statistic}
					unit={loaderData.userPreferences.unitSystem}
				/>
			</Flex>
		</Box>
	);
};

const DisplayStat = (props: { icon: JSX.Element; data: string }) => {
	return (
		<Flex gap={4} align="center">
			{props.icon}
			<Text span size="sm">
				{props.data}
			</Text>
		</Flex>
	);
};
