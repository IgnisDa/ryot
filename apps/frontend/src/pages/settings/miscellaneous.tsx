import { useCoreDetails, useUser } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Button,
	Container,
	Divider,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	DeployRecalculateCalendarEventsJobDocument,
	type DeployRecalculateCalendarEventsJobMutationVariables,
	RegenerateUserSummaryDocument,
	type RegenerateUserSummaryMutationVariables,
	UpdateAllMetadataDocument,
	type UpdateAllMetadataMutationVariables,
	UserLot,
	YankIntegrationDataDocument,
	type YankIntegrationDataMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "../_app";

const Page: NextPageWithLayout = () => {
	const userDetails = useUser();
	const coreDetails = useCoreDetails();
	const regenerateUserSummary = useMutation({
		mutationFn: async (_variables: RegenerateUserSummaryMutationVariables) => {
			const { regenerateUserSummary } = await gqlClient.request(
				RegenerateUserSummaryDocument,
			);
			return regenerateUserSummary;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Summary will be regenerated in the background",
				color: "green",
			});
		},
	});

	const deployUpdateAllMetadataJobs = useMutation({
		mutationFn: async (_variables: UpdateAllMetadataMutationVariables) => {
			const { updateAllMetadata } = await gqlClient.request(
				UpdateAllMetadataDocument,
			);
			return updateAllMetadata;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "All metadata will be updated in the background",
				color: "green",
			});
		},
	});

	const deployRecalculateCalendarEventsJob = useMutation({
		mutationFn: async (
			variables: DeployRecalculateCalendarEventsJobMutationVariables,
		) => {
			const { deployRecalculateCalendarEventsJob } = await gqlClient.request(
				DeployRecalculateCalendarEventsJobDocument,
				variables,
			);
			return deployRecalculateCalendarEventsJob;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Calender events will be updated in the background",
				color: "green",
			});
		},
	});

	const yankIntegrationData = useMutation({
		mutationFn: async (_variables: YankIntegrationDataMutationVariables) => {
			const { yankIntegrationData } = await gqlClient.request(
				YankIntegrationDataDocument,
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
			<Container size="xs">
				<Stack>
					<Title>Miscellaneous settings</Title>
					{userDetails.lot === UserLot.Admin ? (
						<>
							<Box>
								<Title order={4}>Update all metadata</Title>
								<Text>
									Fetch and update the metadata for all the media items that are
									stored. The more media you have, the longer this will take.
								</Text>
							</Box>
							{!coreDetails.data.deployUpdateAllMetadataJobAllowed ? (
								<Text size="xs" color="dimmed">
									Deploying this job is disabled on this instance.
								</Text>
							) : undefined}
							<Button
								onClick={() => deployUpdateAllMetadataJobs.mutate({})}
								loading={deployUpdateAllMetadataJobs.isLoading}
								disabled={!coreDetails.data.deployUpdateAllMetadataJobAllowed}
							>
								Deploy job
							</Button>
							<Divider />
							<Box>
								<Title order={4}>Update Calendar Events</Title>
								<Text>
									Create any pending calendar events, or delete ones that have
									changed. Useful if you have added new media items or dates
									have changed.
								</Text>
							</Box>
							<Button
								onClick={() => deployRecalculateCalendarEventsJob.mutate({})}
								loading={deployRecalculateCalendarEventsJob.isLoading}
							>
								Deploy job
							</Button>
							<Divider />
						</>
					) : undefined}
					<>
						<Box>
							<Title order={4}>Regenerate Summaries</Title>
							<Text>
								Regenerate all pre-computed summaries from the beginning. This
								may be useful if, for some reason, summaries are faulty or
								preconditions have changed. This may take some time.
							</Text>
						</Box>
						<Button
							onClick={() => regenerateUserSummary.mutate({})}
							loading={regenerateUserSummary.isLoading}
						>
							Clean and regenerate
						</Button>
					</>
					<>
						<Box>
							<Title order={4}>Synchronize integrations progress</Title>
							<Text>
								Get data from all configured integrations and update progress if
								applicable. The more integrations you have enabled, the longer
								this will take.
							</Text>
						</Box>
						<Button
							onClick={() => yankIntegrationData.mutate({})}
							loading={yankIntegrationData.isLoading}
						>
							Synchronize
						</Button>
					</>
					<Divider />
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
