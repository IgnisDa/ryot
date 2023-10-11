import { DisplayExerciseStats } from "@/lib/components/FitnessComponents";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getSetColor } from "@/lib/utilities";
import { Container, Flex, Paper, Stack, Text } from "@mantine/core";
import {
	SetLot,
	WorkoutDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import type { NextPageWithLayout } from "../../../_app";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const workoutId = router.query.id?.toString();

	const workoutDetails = useQuery(["workoutDetails"], async () => {
		invariant(workoutId);
		const { workoutDetails } = await gqlClient.request(WorkoutDetailsDocument, {
			workoutId,
		});
		return workoutDetails;
	});

	return workoutDetails.data ? (
		<>
			<Head>
				<title>{workoutDetails.data.name} | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					{workoutDetails.data.information.exercises.map((exercise, idx) => (
						<Paper key={`${exercise.exerciseId}-${idx}`} withBorder p="xs">
							<Text fw="bold" mb="xs">
								{exercise.exerciseName}
							</Text>
							{exercise.sets.map((s, idx) => (
								<Flex key={`${idx}`} align="center">
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
										lot={exercise.exerciseLot}
										statistic={s.statistic}
									/>
								</Flex>
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
