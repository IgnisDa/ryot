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
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	BackgroundJob,
	DeployBackgroundJobDocument,
	UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { ReactNode } from "react";
import { z } from "zod";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails, getUserDetails } from "~/lib/graphql.server";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreDetails, userDetails] = await Promise.all([
		getCoreDetails(),
		getUserDetails(request),
	]);
	return json({
		coreDetails: { deployAdminJobsAllowed: coreDetails.deployAdminJobsAllowed },
		userDetails,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Miscellaneous settings | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	const submission = processSubmission(formData, jobSchema);
	await gqlClient.request(
		DeployBackgroundJobDocument,
		submission,
		await getAuthorizationHeader(request),
	);
	return json({ status: "success" } as const, {
		headers: await createToastHeaders({
			type: "success",
			message: "Job has been deployed",
		}),
	});
};

const jobSchema = z.object({
	jobName: z.nativeEnum(BackgroundJob),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container size="lg">
			<Form replace method="post">
				<Stack>
					<Title>Miscellaneous settings</Title>
					<SimpleGrid
						cols={{ base: 1, lg: 2 }}
						spacing={{ base: "xl", md: "md" }}
					>
						{loaderData.userDetails.lot === UserLot.Admin ? (
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
										enabled={!loaderData.coreDetails.deployAdminJobsAllowed}
									>
										<Button
											disabled={!loaderData.coreDetails.deployAdminJobsAllowed}
											{...buttonProps}
											name="jobName"
											value={BackgroundJob.UpdateAllMetadata}
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
										enabled={!loaderData.coreDetails.deployAdminJobsAllowed}
									>
										<Button
											disabled={!loaderData.coreDetails.deployAdminJobsAllowed}
											{...buttonProps}
											name="jobName"
											value={BackgroundJob.RecalculateCalendarEvents}
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
										enabled={!loaderData.coreDetails.deployAdminJobsAllowed}
									>
										<Button
											disabled={!loaderData.coreDetails.deployAdminJobsAllowed}
											{...buttonProps}
											name="jobName"
											value={BackgroundJob.UpdateAllExercises}
										>
											Update exercises
										</Button>
									</DisabledNotice>
								</Stack>
							</>
						) : null}
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
								{...buttonProps}
								name="jobName"
								value={BackgroundJob.CalculateSummary}
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
								{...buttonProps}
								name="jobName"
								value={BackgroundJob.EvaluateWorkouts}
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
								{...buttonProps}
								name="jobName"
								value={BackgroundJob.YankIntegrationsData}
							>
								Synchronize
							</Button>
						</Stack>
					</SimpleGrid>
				</Stack>
			</Form>
		</Container>
	);
}

const buttonProps = { variant: "light", type: "submit" as const };

const DisabledNotice = (props: {
	children: ReactNode;
	enabled: boolean;
}) => (
	<Tooltip
		label="Deploying this job is disabled on this instance"
		disabled={!props.enabled}
	>
		{props.children}
	</Tooltip>
);
