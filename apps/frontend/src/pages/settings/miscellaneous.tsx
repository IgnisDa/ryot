import { useCoreDetails, useUser } from "@/lib/hooks";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Button,
	Container,
	SimpleGrid,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	BackgroundJob,
	DeployBackgroundJobDocument,
	type DeployBackgroundJobMutationVariables,
	UserLot,
	YankIntegrationDataDocument,
	type YankIntegrationDataMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "../_app";

const buttonProps = { variant: "light" };

const DisabledNotice = (props: {
	children: JSX.Element;
	enabled: boolean;
}) => (
	<Tooltip
		label="Deploying this job is disabled on this instance"
		disabled={!props.enabled}
	>
		{props.children}
	</Tooltip>
);

const Page: NextPageWithLayout = () => {
	const userDetails = useUser();
	const coreDetails = useCoreDetails();
	const deployBackgroundJob = useMutation({
		mutationFn: async (variables: DeployBackgroundJobMutationVariables) => {
			const { deployBackgroundJob } = await gqlClient.request(
				DeployBackgroundJobDocument,
				variables,
			);
			return deployBackgroundJob;
		},
		onSuccess: () => {},
	});

	const yankIntegrationData = useMutation({
		mutationFn: async (variables: YankIntegrationDataMutationVariables) => {
			const { yankIntegrationData } = await gqlClient.request(
				YankIntegrationDataDocument,
				variables,
			);
			return yankIntegrationData;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Progress data has been synchronized successfully",
				color: "green",
			});
		},
	});

	return coreDetails.data && userDetails ? (
		<>
			<Head>
				<title>Miscellaneous Settings | Ryot</title>
			</Head>
			<Container size="lg">
				<Stack>
					<Title>Miscellaneous settings</Title>
					<SimpleGrid
						cols={{ base: 1, lg: 2 }}
						spacing={{ base: "xl", md: "md" }}
					>
						{userDetails.lot === UserLot.Admin ? (
							<>
								<Stack>
									<Box>
										<Title order={4}>Update all metadata</Title>
										<Text>
											Fetch and update the metadata for all the media items that
											are stored. The more media you have, the longer this will
											take. This also updates people and group data from remote
											providers.
										</Text>
									</Box>
									<DisabledNotice
										enabled={!coreDetails.data.deployAdminJobsAllowed}
									>
										<Button
											onClick={async () => {
												deployBackgroundJob.mutateAsync({
													jobName: BackgroundJob.UpdateAllMetadata,
												});
												notifications.show({
													title: "Success",
													message:
														"All metadata will be updated in the background",
													color: "green",
												});
											}}
											disabled={!coreDetails.data.deployAdminJobsAllowed}
											{...buttonProps}
										>
											Update metadata
										</Button>
									</DisabledNotice>
								</Stack>
								<Stack>
									<Box>
										<Title order={4}>Update Calendar Events</Title>
										<Text>
											Create any pending calendar events, or delete ones that
											have changed. Useful if you have added new media items or
											publish dates have changed. This is run every 24 hours
											automatically.
										</Text>
									</Box>
									<DisabledNotice
										enabled={!coreDetails.data.deployAdminJobsAllowed}
									>
										<Button
											onClick={async () => {
												deployBackgroundJob.mutateAsync({
													jobName: BackgroundJob.RecalculateCalendarEvents,
												});
												notifications.show({
													title: "Success",
													message:
														"Calender events will be updated in the background",
													color: "green",
												});
											}}
											disabled={!coreDetails.data.deployAdminJobsAllowed}
											{...buttonProps}
										>
											Update calendar events
										</Button>
									</DisabledNotice>
								</Stack>
								<Stack>
									<Box>
										<Title order={4}>Update Exercises</Title>
										<Text>
											Update the exercise database. Exercise data is downloaded
											on startup but they can be updated manually. Trigger this
											job when there are new exercises available.
										</Text>
									</Box>
									<DisabledNotice
										enabled={!coreDetails.data.deployAdminJobsAllowed}
									>
										<Button
											onClick={async () => {
												deployBackgroundJob.mutateAsync({
													jobName: BackgroundJob.UpdateAllExercises,
												});
												notifications.show({
													title: "Success",
													message:
														"Exercises will be updated in the background",
													color: "green",
												});
											}}
											disabled={!coreDetails.data.deployAdminJobsAllowed}
											{...buttonProps}
										>
											Update exercises
										</Button>
									</DisabledNotice>
								</Stack>
							</>
						) : undefined}
						<Stack>
							<Box>
								<Title order={4}>Regenerate Summaries</Title>
								<Text>
									Regenerate all pre-computed summaries from the beginning. This
									may be useful if, for some reason, summaries are faulty or
									preconditions have changed. This may take some time.
								</Text>
							</Box>
							<Button
								onClick={async () => {
									deployBackgroundJob.mutateAsync({
										jobName: BackgroundJob.CalculateSummary,
									});
									notifications.show({
										title: "Success",
										message: "Summary will be regenerated in the background",
										color: "green",
									});
								}}
								{...buttonProps}
							>
								Clean and regenerate
							</Button>
						</Stack>
						<Stack>
							<Box>
								<Title order={4}>Re-evaluate workouts</Title>
								<Text>
									Re-evaluate all workouts. This may be useful if exercises done
									during a workout have changed or workouts have been edited or
									deleted.
								</Text>
							</Box>
							<Button
								onClick={async () => {
									deployBackgroundJob.mutateAsync({
										jobName: BackgroundJob.EvaluateWorkouts,
									});
									notifications.show({
										title: "Success",
										message: "Workouts will be re-evaluated in the background",
										color: "green",
									});
								}}
								{...buttonProps}
							>
								Re-evaluate workouts
							</Button>
						</Stack>
						<Stack>
							<Box>
								<Title order={4}>Synchronize integrations progress</Title>
								<Text>
									Get data from all configured integrations and update progress
									if applicable. The more integrations you have enabled, the
									longer this will take.
								</Text>
							</Box>
							<Button
								onClick={() => yankIntegrationData.mutate({})}
								{...buttonProps}
							>
								Synchronize
							</Button>
						</Stack>
					</SimpleGrid>
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
