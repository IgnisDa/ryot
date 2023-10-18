import { DisplayExerciseStats } from "@/lib/components/FitnessComponents";
import { APP_ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getSetColor } from "@/lib/utilities";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Container,
	Flex,
	Group,
	Menu,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	DeleteUserWorkoutDocument,
	type DeleteUserWorkoutMutationVariables,
	SetLot,
	WorkoutDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconClock,
	IconDotsVertical,
	IconTrash,
	IconTrophy,
	IconWeight,
	IconZzz,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	HumanizeDuration,
	HumanizeDurationLanguage,
} from "humanize-duration-ts";
import { DateTime } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../../_app";

const service = new HumanizeDurationLanguage();
const humanizer = new HumanizeDuration(service);

const DisplayStat = (props: {
	icon: ReactElement;
	data: string;
}) => {
	return (
		<Flex gap={4} align="center">
			{props.icon}
			<Text span size="sm">
				{props.data}
			</Text>
		</Flex>
	);
};

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const workoutId = router.query.id?.toString();

	const workoutDetails = useQuery({
		queryKey: ["workoutDetails"],
		queryFn: async () => {
			invariant(workoutId);
			const { workoutDetails } = await gqlClient.request(
				WorkoutDetailsDocument,
				{
					workoutId,
				},
			);
			return workoutDetails;
		},
		staleTime: Infinity,
	});

	const deleteWorkout = useMutation({
		mutationFn: async (variables: DeleteUserWorkoutMutationVariables) => {
			const { deleteUserWorkout } = await gqlClient.request(
				DeleteUserWorkoutDocument,
				variables,
			);
			return deleteUserWorkout;
		},
		onSuccess: () => {
			router.push(APP_ROUTES.fitness.workouts);
		},
	});

	return workoutDetails.data && workoutId ? (
		<>
			<Head>
				<title>{workoutDetails.data.name} | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Group justify="space-between">
						<Title>{workoutDetails.data.name}</Title>
						<Menu shadow="md" position="bottom-end">
							<Menu.Target>
								<ActionIcon>
									<IconDotsVertical />
								</ActionIcon>
							</Menu.Target>
							<Menu.Dropdown>
								<Menu.Item
									onClick={() => {
										const yes = confirm(
											"Are you sure you want to delete this workout? This action is not reversible.",
										);
										if (yes) deleteWorkout.mutate({ workoutId });
									}}
									color="red"
									leftSection={<IconTrash size={14} />}
								>
									Delete
								</Menu.Item>
							</Menu.Dropdown>
						</Menu>
					</Group>
					<Box>
						<Text c="dimmed" span>
							Done on{" "}
						</Text>
						<Text span>
							{DateTime.fromJSDate(
								workoutDetails.data.startTime,
							).toLocaleString(DateTime.DATETIME_MED)}
						</Text>
						<Group mt="xs" gap="lg">
							<DisplayStat
								icon={<IconClock size={16} />}
								data={humanizer.humanize(
									workoutDetails.data.endTime.getTime() -
										workoutDetails.data.startTime.getTime(),
									{ round: true },
								)}
							/>
							<DisplayStat
								icon={<IconWeight size={16} />}
								data={new Intl.NumberFormat("en-us", {
									style: "unit",
									unit: "kilogram",
								}).format(Number(workoutDetails.data.summary.total.weight))}
							/>
							<DisplayStat
								icon={<IconTrophy size={16} />}
								data={`${workoutDetails.data.summary.total.personalBestsAchieved.toString()} PRs`}
							/>
						</Group>
					</Box>
					{workoutDetails.data.comment ? (
						<Box>
							<Text c="dimmed" span>
								Commented:{" "}
							</Text>
							<Text span>{workoutDetails.data.comment}</Text>
						</Box>
					) : undefined}
					{workoutDetails.data.information.exercises.map((exercise, idx) => (
						<Paper key={`${exercise.id}-${idx}`} withBorder p="xs">
							<Box mb="xs">
								<Group justify="space-between">
									<Anchor
										component={Link}
										href={withQuery(APP_ROUTES.fitness.exercises.details, {
											id: exercise.id,
										})}
										fw="bold"
									>
										{exercise.name}
									</Anchor>
									{exercise.restTime ? (
										<Flex align="center" gap="xs">
											<IconZzz size={14} />
											<Text fz="xs">{exercise.restTime}s</Text>
										</Flex>
									) : undefined}
								</Group>
								{exercise.notes.map((n) => (
									<Text c="dimmed" key={n} size="xs">
										{n}
									</Text>
								))}
							</Box>
							{exercise.sets.map((s, idx) => (
								<Box key={`${idx}`}>
									{exercise.assets.images.length > 0 ? (
										<Avatar.Group>
											{exercise.assets.images.map((i) => (
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
									<Flex align="center">
										<Text
											fz="sm"
											c={getSetColor(s.lot)}
											mr="md"
											fw="bold"
											ff="monospace"
										>
											{match(s.lot)
												.with(SetLot.Normal, () => idx + 1)
												.otherwise(() => s.lot.at(0))}
										</Text>
										<DisplayExerciseStats
											lot={exercise.lot}
											statistic={s.statistic}
											personalBests={s.personalBests}
										/>
									</Flex>
								</Box>
							))}
						</Paper>
					))}
				</Stack>
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
