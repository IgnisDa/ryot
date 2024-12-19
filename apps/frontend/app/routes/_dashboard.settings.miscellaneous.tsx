import {
	Box,
	Button,
	Container,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import type { ActionFunctionArgs, MetaArgs } from "@remix-run/node";
import { Form, data } from "@remix-run/react";
import {
	BackgroundJob,
	DeployBackgroundJobDocument,
	UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { processSubmission } from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { z } from "zod";
import { useDashboardLayoutData, useUserDetails } from "~/lib/hooks";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";

export const meta = (_args: MetaArgs) => {
	return [{ title: "Miscellaneous settings | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	const submission = processSubmission(formData, jobSchema);
	await serverGqlService.authenticatedRequest(
		request,
		DeployBackgroundJobDocument,
		submission,
	);
	return data({} as const, {
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
	return (
		<Container size="lg">
			<Form replace method="POST">
				<Stack>
					<Title>Miscellaneous settings</Title>
					<SimpleGrid
						cols={{ base: 1, lg: 2 }}
						spacing={{ base: "xl", md: "md" }}
					>
						{Object.values(BackgroundJob).map((job) => (
							<DisplayJobBtn key={job} job={job} />
						))}
					</SimpleGrid>
				</Stack>
			</Form>
		</Container>
	);
}

const DisplayJobBtn = (props: { job: BackgroundJob }) => {
	const userDetails = useUserDetails();
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemo;

	const [title, description, isAdminOnly] = match(props.job)
		.with(
			BackgroundJob.UpdateAllMetadata,
			() =>
				[
					"Update all metadata",
					"Fetch and update the metadata for all the media items that are stored. The more media you have, the longer this will take. This also updates people and group data from remote providers.",
					true,
				] as const,
		)
		.with(
			BackgroundJob.UpdateAllExercises,
			() =>
				[
					"Update all exercises",
					"Update the exercise database. Exercise data is downloaded on startup but they can be updated manually. Trigger this job when there are new exercises available.",
					true,
				] as const,
		)
		.with(
			BackgroundJob.PerformBackgroundTasks,
			() =>
				[
					"Perform background tasks",
					"Update the user summaries, recalculate media associations for all users, update all monitored entities and remove useless data. The more users you have, the longer this will take.",
					true,
				] as const,
		)
		.with(
			BackgroundJob.DeleteAllApplicationCache,
			() =>
				[
					"Delete all cache",
					"Delete all application caches. Use this if you updated a critical configuration parameter and can not see the changes reflected in the UI.",
					true,
				] as const,
		)
		.with(
			BackgroundJob.CalculateUserActivitiesAndSummary,
			() =>
				[
					"Regenerate Summaries",
					"Regenerate all pre-computed summaries from the beginning. This may be useful if, for some reason, summaries are faulty or preconditions have changed. This may take some time.",
				] as const,
		)
		.with(
			BackgroundJob.ReviseUserWorkouts,
			() =>
				[
					"Revise workouts",
					"Revise all workouts. This may be useful if exercises done during a workout have changed or workouts have been edited or deleted.",
				] as const,
		)
		.with(
			BackgroundJob.SyncIntegrationsData,
			() =>
				[
					"Synchronize integrations progress",
					"Get/push data for all configured integrations and update progress if applicable. The more integrations you have enabled, the longer this will take.",
				] as const,
		)
		.exhaustive();

	if (isAdminOnly && userDetails.lot !== UserLot.Admin) return null;

	return (
		<Stack>
			<Box>
				<Title order={4}>{title}</Title>
				<Text>{description}</Text>
			</Box>
			<Button
				mt="auto"
				type="submit"
				name="jobName"
				variant="light"
				value={props.job}
				disabled={isEditDisabled}
			>
				{title}
			</Button>
		</Stack>
	);
};
