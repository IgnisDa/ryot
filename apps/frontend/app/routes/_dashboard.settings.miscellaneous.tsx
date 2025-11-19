import {
	Box,
	Button,
	Container,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	BackgroundJob,
	DeployBackgroundJobDocument,
	GenerateLogDownloadTokenDocument,
	UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { processSubmission } from "@ryot/ts-utils";
import { useMutation } from "@tanstack/react-query";
import { Form, data, useNavigate } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { match } from "ts-pattern";
import { z } from "zod";
import { applicationBaseUrl } from "~/lib/shared/constants";
import {
	useConfirmSubmit,
	useDashboardLayoutData,
	useInvalidateUserDetails,
	useIsMobile,
	useIsOnboardingTourCompleted,
	useMarkUserOnboardingTourStatus,
	useUserDetails,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { useOnboardingTour } from "~/lib/state/onboarding-tour";
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
	jobName: z.enum(BackgroundJob),
});

export default function Page() {
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const { startOnboardingTour } = useOnboardingTour();
	const isOnboardingTourCompleted = useIsOnboardingTourCompleted();
	const markUserOnboardingStatus = useMarkUserOnboardingTourStatus();

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
					<DownloadLogsButton />
					<ClientOnly>
						{() =>
							isOnboardingTourCompleted && !isMobile ? (
								<Stack>
									<Box>
										<Title order={4}>Onboarding</Title>
										<Text>Restart the application onboarding tour.</Text>
									</Box>
									<Button
										mt="auto"
										variant="light"
										onClick={async () => {
											await startOnboardingTour();
											await markUserOnboardingStatus.mutateAsync(false);
											navigate("/");
										}}
									>
										Restart onboarding
									</Button>
								</Stack>
							) : null
						}
					</ClientOnly>
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
	const submit = useConfirmSubmit();
	const userDetails = useUserDetails();
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemoInstance;
	const invalidateUserDetails = useInvalidateUserDetails();

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
							async () => {
								submit(form);
								await invalidateUserDetails();
							},
						);
					}}
				>
					{title}
				</Button>
			</Stack>
		</Form>
	);
};

const DownloadLogsButton = () => {
	const userDetails = useUserDetails();
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemoInstance;

	if (userDetails.lot !== UserLot.Admin) return null;

	const downloadLogsMutation = useMutation({
		mutationFn: async () => {
			const { generateLogDownloadToken } = await clientGqlService.request(
				GenerateLogDownloadTokenDocument,
				{},
			);
			return generateLogDownloadToken;
		},
		onSuccess: (token) => {
			const downloadUrl = `${applicationBaseUrl}/backend/logs/download/${token}`;
			window.open(downloadUrl, "_blank", "noopener,noreferrer");
			notifications.show({
				color: "green",
				title: "Success",
				message: "Opening log download in a new tab",
			});
		},
		onError: () => {
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to generate log download token",
			});
		},
	});

	return (
		<Stack>
			<Box>
				<Title order={4}>Download Logs</Title>
				<Text>
					Download application logs for debugging and troubleshooting purposes.
				</Text>
			</Box>
			<Button
				mt="auto"
				variant="light"
				disabled={isEditDisabled}
				loading={downloadLogsMutation.isPending}
				onClick={() => downloadLogsMutation.mutate()}
			>
				Download Logs
			</Button>
		</Stack>
	);
};
