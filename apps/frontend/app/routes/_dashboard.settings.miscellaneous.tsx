import {
	ActionIcon,
	Box,
	Button,
	Container,
	Group,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	Title,
	useMantineTheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	BackgroundJob,
	DeployBackgroundJobDocument,
	GenerateLogDownloadUrlDocument,
	UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { processSubmission } from "@ryot/ts-utils";
import {
	IconActivity,
	IconBarbell,
	IconChartBar,
	IconCloudDownload,
	IconDownload,
	IconPlayerPlay,
	IconRefresh,
	IconRocket,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { data, Form, useNavigate } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { match } from "ts-pattern";
import { z } from "zod";
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
import { openConfirmationModal, triggerDownload } from "~/lib/shared/ui-utils";
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
				<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
					{Object.values(BackgroundJob).map((job) => (
						<DisplayJobBtn key={job} job={job} />
					))}
					<DownloadLogsButton />
					<ClientOnly>
						{() =>
							isOnboardingTourCompleted && !isMobile ? (
								<SettingsActionCard
									title="Onboarding"
									buttonText="Restart onboarding"
									icon={<IconRocket size={28} />}
									description="Restart the application onboarding tour."
									buttonProps={{
										onClick: async () => {
											await startOnboardingTour();
											await markUserOnboardingStatus.mutateAsync(false);
											navigate("/");
										},
									}}
								/>
							) : null
						}
					</ClientOnly>
				</SimpleGrid>
			</Stack>
		</Container>
	);
}

const SettingsActionCard = (props: {
	title: string;
	icon: ReactNode;
	buttonText: string;
	description: string;
	buttonProps?: ComponentPropsWithoutRef<typeof Button>;
}) => {
	const theme = useMantineTheme();

	return (
		<Paper
			withBorder
			radius="md"
			p={{ base: "sm", md: "lg" }}
			style={{
				height: "100%",
				display: "flex",
				flexDirection: "column",
				transition: "transform 0.2s, box-shadow 0.2s",
			}}
		>
			<Stack gap="md" style={{ flex: 1 }}>
				<Group gap="md" wrap="nowrap">
					<ActionIcon
						size={56}
						radius="md"
						variant="light"
						style={{ flexShrink: 0 }}
						color={theme.primaryColor}
					>
						{props.icon}
					</ActionIcon>
					<Box style={{ flex: 1, minWidth: 0 }}>
						<Title order={4} lineClamp={2}>
							{props.title}
						</Title>
					</Box>
				</Group>
				<Text size="sm" c="dimmed" style={{ flex: 1 }}>
					{props.description}
				</Text>
				<Button fullWidth variant="light" {...props.buttonProps}>
					{props.buttonText}
				</Button>
			</Stack>
		</Paper>
	);
};

const getJobDetails = (job: BackgroundJob) =>
	match(job)
		.with(
			BackgroundJob.UpdateAllMetadata,
			() =>
				[
					<IconRefresh size={28} key={job} />,
					"Update all metadata",
					"Mark all stored media items as partial so they will be automatically updated in the background the next time you view them.",
					true,
				] as const,
		)
		.with(
			BackgroundJob.UpdateAllExercises,
			() =>
				[
					<IconBarbell size={28} key={job} />,
					"Update all exercises",
					"Update the exercise database. Exercise data is downloaded on startup but they can be updated manually. Trigger this job when there are new exercises available.",
					true,
				] as const,
		)
		.with(
			BackgroundJob.PerformBackgroundTasks,
			() =>
				[
					<IconPlayerPlay size={28} key={job} />,
					"Perform background tasks",
					"Update the user summaries, recalculate media associations for all users, update all monitored entities and remove useless data. The more users you have, the longer this will take.",
					true,
				] as const,
		)
		.with(
			BackgroundJob.CalculateUserActivitiesAndSummary,
			() =>
				[
					<IconChartBar size={28} key={job} />,
					"Regenerate Summaries",
					"Regenerate all pre-computed summaries from the beginning. This may be useful if, for some reason, summaries are faulty or preconditions have changed. This may take some time.",
				] as const,
		)
		.with(
			BackgroundJob.ReviseUserWorkouts,
			() =>
				[
					<IconActivity size={28} key={job} />,
					"Revise workouts",
					"Revise all workouts. This may be useful if exercises done during a workout have changed or workouts have been edited or deleted.",
				] as const,
		)
		.with(
			BackgroundJob.SyncIntegrationsData,
			() =>
				[
					<IconCloudDownload size={28} key={job} />,
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

	const jobDetails = getJobDetails(props.job);
	const [icon, title, description, isAdminOnly] = jobDetails;

	if (isAdminOnly && userDetails.lot !== UserLot.Admin) return null;

	return (
		<Form replace method="POST">
			<input hidden name="jobName" defaultValue={props.job} />
			<SettingsActionCard
				icon={icon}
				title={title}
				buttonText={title}
				description={description}
				buttonProps={{
					type: "submit",
					disabled: isEditDisabled,
					onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
						const form = e.currentTarget.form;
						e.preventDefault();
						openConfirmationModal(
							"Are you sure you want to perform this task?",
							async () => {
								submit(form);
								await invalidateUserDetails();
							},
						);
					},
				}}
			/>
		</Form>
	);
};

const DownloadLogsButton = () => {
	const userDetails = useUserDetails();
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemoInstance;

	const downloadLogsMutation = useMutation({
		mutationFn: async () => {
			const { generateLogDownloadUrl } = await clientGqlService.request(
				GenerateLogDownloadUrlDocument,
			);
			return generateLogDownloadUrl;
		},
		onSuccess: (downloadUrl) => {
			triggerDownload(downloadUrl, "ryot.log");
		},
		onError: () => {
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to generate log download URL",
			});
		},
	});

	if (userDetails.lot !== UserLot.Admin) return null;

	return (
		<SettingsActionCard
			title="Download Logs"
			buttonText="Download Logs"
			icon={<IconDownload size={28} />}
			description="Download application logs for debugging and troubleshooting purposes."
			buttonProps={{
				disabled: isEditDisabled,
				loading: downloadLogsMutation.isPending,
				onClick: () => downloadLogsMutation.mutate(),
			}}
		/>
	);
};
