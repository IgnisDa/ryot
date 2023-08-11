import type { NextPageWithLayout } from "../../_app";
import { APP_ROUTES } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { currentWorkoutAtom } from "@/lib/state";
import { Button, Container, Stack, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { RESET } from "jotai/utils";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const [currentWorkout, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	return (
		<>
			<Head>
				<title>Workout in progress | Ryot</title>
			</Head>
			<Container>
				{currentWorkout ? (
					<Stack>
						<Button
							onClick={() => {
								setCurrentWorkout(RESET);
								return router.push(APP_ROUTES.dashboard);
							}}
						>
							Finish workout
						</Button>
						<Text>Started workout at {currentWorkout.startTime}</Text>
					</Stack>
				) : (
					<Text>
						You do not have any workout in progress. Please start a new one from
						the dashboard.
					</Text>
				)}
				<Text>This page is still a WIP.</Text>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
