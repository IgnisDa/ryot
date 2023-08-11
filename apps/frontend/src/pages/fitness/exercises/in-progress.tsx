import type { NextPageWithLayout } from "../../_app";
import { APP_ROUTES } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { currentWorkoutAtom } from "@/lib/state";
import {
	Box,
	Button,
	Container,
	Flex,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useAtom } from "jotai";
import { RESET } from "jotai/utils";
import { DateTime, Duration } from "luxon";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import { useStopwatch } from "react-timer-hook";

const offsetDate = (startTime: string) => {
	const now = DateTime.now();
	const duration = now.diff(DateTime.fromISO(startTime));
	return now.plus(duration).toJSDate();
};

const DurationTimer = ({ startTime }: { startTime?: string }) => {
	const { totalSeconds } = useStopwatch({
		autoStart: true,
		offsetTimestamp: startTime ? offsetDate(startTime) : undefined,
	});

	return (
		<Box mx="auto">
			<Text color="dimmed" size="xs">
				Duration
			</Text>
			<Text align="center" size="xl">
				{Duration.fromObject({ seconds: totalSeconds }).toFormat("mm:ss")}
			</Text>
		</Box>
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
						{JSON.stringify(currentWorkout)}
						<Flex align="center">
							<TextInput
								size="lg"
								placeholder="A name for your workout"
								value={currentWorkout.name}
								onChange={(e) =>
									setCurrentWorkout({
										...currentWorkout,
										name: e.currentTarget.value,
									})
								}
							/>
							<DurationTimer startTime={currentWorkout.startTime} />
						</Flex>
						<Button
							onClick={() => {
								setCurrentWorkout(RESET);
								return router.push(APP_ROUTES.dashboard);
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
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
