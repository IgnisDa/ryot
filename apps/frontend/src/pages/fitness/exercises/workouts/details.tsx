import { DisplayExerciseStats } from "@/lib/components/FitnessComponents";
import { APP_ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getSetColor } from "@/lib/utilities";
import {
	Anchor,
	Avatar,
	Box,
	Container,
	Flex,
	Group,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	SetLot,
	WorkoutDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconClock, IconTrophy, IconWeight } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
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

	const workoutDetails = useQuery(
		["workoutDetails"],
		async () => {
			invariant(workoutId);
			const { workoutDetails } = await gqlClient.request(
				WorkoutDetailsDocument,
				{
					workoutId,
				},
			);
			return workoutDetails;
		},
		{ staleTime: Infinity },
	);

	return workoutDetails.data ? (
		<>
			<Head>
				<title>{workoutDetails.data.name} | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>{workoutDetails.data.name}</Title>
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
								<Anchor
									component={Link}
									href={withQuery(APP_ROUTES.fitness.exercises.details, {
										id: exercise.id,
									})}
									fw="bold"
								>
									{exercise.name}
								</Anchor>
							</Box>
							{exercise.sets.map((s, idx) => (
								<Box
									key={`${idx}`}
									pt={
										idx !== 0 &&
										(exercise.assets.images.length > 0 ||
											exercise.assets.videos.length > 0 ||
											exercise.notes.length > 0)
											? "xs"
											: undefined
									}
								>
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
									{exercise.notes.map((n) => (
										<Text c="dimmed" key={n} size="xs">
											{n}
										</Text>
									))}
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
