import {
	Box,
	Button,
	Container,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { unstable_defineAction } from "@remix-run/node";
import { Form, type MetaArgs_SingleFetch } from "@remix-run/react";
import {
	BackgroundJob,
	DeployBackgroundJobDocument,
	UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { processSubmission } from "@ryot/ts-utils";
import { z } from "zod";
import { useUserDetails } from "~/lib/hooks";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";

export const meta = (_args: MetaArgs_SingleFetch) => {
	return [{ title: "Miscellaneous settings | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	const submission = processSubmission(formData, jobSchema);
	await serverGqlService.authenticatedRequest(
		request,
		DeployBackgroundJobDocument,
		submission,
	);
	return Response.json({ status: "success" } as const, {
		headers: await createToastHeaders({
			type: "success",
			message: "Job has been deployed",
		}),
	});
});

const jobSchema = z.object({
	jobName: z.nativeEnum(BackgroundJob),
});

export default function Page() {
	const userDetails = useUserDetails();

	return (
		<Container size="lg">
			<Form replace method="POST">
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
									<Button {...btnProps} value={BackgroundJob.UpdateAllMetadata}>
										Update metadata
									</Button>
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
									<Button
										{...btnProps}
										value={BackgroundJob.RecalculateCalendarEvents}
									>
										Update calendar events
									</Button>
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
									<Button
										{...btnProps}
										value={BackgroundJob.UpdateAllExercises}
									>
										Update exercises
									</Button>
								</Stack>
								<Stack>
									<Box>
										<Title order={4}>Perform all background tasks</Title>
										<Text>
											Update the user summaries, recalculate media associations
											for all users, update all monitored entities and remove
											useless data. The more users you have, the longer this
											will take.
										</Text>
									</Box>
									<Button
										{...btnProps}
										value={BackgroundJob.PerformBackgroundTasks}
									>
										Perform background tasks
									</Button>
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
								{...btnProps}
								value={BackgroundJob.CalculateUserActivitiesAndSummary}
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
								{...btnProps}
								value={BackgroundJob.ReEvaluateUserWorkouts}
							>
								Re-evaluate workouts
							</Button>
						</Stack>
						<Stack>
							<Box>
								<Title order={4}>Synchronize integrations progress</Title>
								<Text>
									Get/push data for all configured integrations and update
									progress if applicable. The more integrations you have
									enabled, the longer this will take.
								</Text>
							</Box>
							<Button {...btnProps} value={BackgroundJob.SyncIntegrationsData}>
								Synchronize
							</Button>
						</Stack>
					</SimpleGrid>
				</Stack>
			</Form>
		</Container>
	);
}

const btnProps = {
	variant: "light",
	type: "submit" as const,
	name: "jobName",
};
