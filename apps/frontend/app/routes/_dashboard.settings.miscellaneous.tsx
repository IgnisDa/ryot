import {
	Box,
	Button,
	Container,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	BackgroundJob,
	DeployBackgroundJobDocument,
	UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { processSubmission } from "@ryot/ts-utils";
import { Form, data } from "react-router";
import { match } from "ts-pattern";
import { z } from "zod";
import { openConfirmationModal } from "~/lib/common";
import {
	useConfirmSubmit,
	useDashboardLayoutData,
	useUserDetails,
} from "~/lib/hooks";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.miscellaneous";

export const meta = () => {
	return [{ title: "Miscellaneous settings | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
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
		</Container>
	);
}

const getJobDetails = (job: BackgroundJob) =>
	match(job)
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

const DisplayJobBtn = (props: { job: BackgroundJob }) => {
	const userDetails = useUserDetails();
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemoInstance;
	const submit = useConfirmSubmit();

	const [title, description, isAdminOnly] = getJobDetails(props.job);

	if (isAdminOnly && userDetails.lot !== UserLot.Admin) return null;

	return (
		<Form replace method="POST">
			<input hidden name="jobName" defaultValue={props.job} />
			<Stack>
				<Box>
					<Title order={4}>{title}</Title>
					<Text>{description}</Text>
				</Box>
				<Button
					mt="auto"
					type="submit"
					variant="light"
					disabled={isEditDisabled}
					onClick={(e) => {
						const form = e.currentTarget.form;
						e.preventDefault();
						openConfirmationModal(
							"Are you sure you want to perform this task?",
							() => submit(form),
						);
					}}
				>
					{title}
				</Button>
			</Stack>
		</Form>
	);
};
