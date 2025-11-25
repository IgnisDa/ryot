import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Collapse,
	Container,
	Flex,
	Group,
	Modal,
	NumberInput,
	Paper,
	Select,
	Stack,
	Switch,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure, useListState } from "@mantine/hooks";
import {
	CreateUserNotificationPlatformDocument,
	DeleteUserNotificationPlatformDocument,
	NotificationPlatformLot,
	TestUserNotificationPlatformsDocument,
	UpdateUserNotificationPlatformDocument,
	UserNotificationContentDiscriminants,
	UserNotificationPlatformsDocument,
	type UserNotificationPlatformsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	getActionIntent,
	processSubmission,
	zodCheckboxAsString,
} from "@ryot/ts-utils";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { Form, data, useLoaderData } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useConfirmSubmit } from "~/lib/shared/hooks";
import {
	convertEnumToSelectData,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import { zodCommaDelimitedString } from "~/lib/shared/validation";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.notifications";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const [{ userNotificationPlatforms }] = await Promise.all([
		serverGqlService.authenticatedRequest(
			request,
			UserNotificationPlatformsDocument,
			{},
		),
	]);
	return { userNotificationPlatforms };
};

export const meta = () => {
	return [{ title: "Notification Settings | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("create", async () => {
			const submission = processSubmission(formData, createSchema);
			await serverGqlService.authenticatedRequest(
				request,
				CreateUserNotificationPlatformDocument,
				{ input: submission },
			);
			return data({ status: "success", submission } as const);
		})
		.with("delete", async () => {
			const submission = processSubmission(formData, deleteSchema);
			await serverGqlService.authenticatedRequest(
				request,
				DeleteUserNotificationPlatformDocument,
				submission,
			);
			return data({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Notification platform deleted successfully",
				}),
			});
		})
		.with("test", async () => {
			const { testUserNotificationPlatforms } =
				await serverGqlService.authenticatedRequest(
					request,
					TestUserNotificationPlatformsDocument,
					{},
				);
			return data({ status: "success" } as const, {
				headers: await createToastHeaders({
					type: testUserNotificationPlatforms ? "success" : "error",
					message: testUserNotificationPlatforms
						? "Please check your notification platforms"
						: "Something went wrong",
				}),
			});
		})
		.with("update", async () => {
			const submission = processSubmission(formData, updateSchema);
			submission.isDisabled = submission.isDisabled === true;
			await serverGqlService.authenticatedRequest(
				request,
				UpdateUserNotificationPlatformDocument,
				{ input: submission },
			);
			return data({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Notification updated successfully",
				}),
			});
		})
		.run();
};

const deleteSchema = z.object({ notificationId: z.string() });

const createSchema = z.object({
	lot: z.enum(NotificationPlatformLot),
	chatId: z.string().optional(),
	baseUrl: z.string().optional(),
	apiToken: z.string().optional(),
	authHeader: z.string().optional(),
	priority: z.number().optional(),
});

const updateSchema = z.object({
	notificationId: z.string(),
	isDisabled: zodCheckboxAsString,
	configuredEvents: zodCommaDelimitedString.transform(
		(v) => v as UserNotificationContentDiscriminants[],
	),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [
		createUserNotificationPlatformModalOpened,
		{
			open: openCreateUserNotificationPlatformModal,
			close: closeCreateUserNotificationPlatformModal,
		},
	] = useDisclosure(false);

	const createForm = useForm<{
		lot: NotificationPlatformLot | "";
		baseUrl?: string;
		apiToken?: string;
		chatId?: string;
		authHeader?: string;
		priority?: number;
	}>({
		initialValues: {
			lot: "",
			baseUrl: "",
			apiToken: "",
			chatId: "",
			authHeader: "",
			priority: undefined,
		},
		validate: {
			lot: (value) => (value ? null : "Please select a platform"),
		},
	});

	return (
		<>
			<Modal
				centered
				withCloseButton={false}
				opened={createUserNotificationPlatformModalOpened}
				onClose={() => {
					closeCreateUserNotificationPlatformModal();
					createForm.reset();
				}}
			>
				<Box
					method="POST"
					component={Form}
					action={withQuery(".", { intent: "create" })}
					onSubmit={createForm.onSubmit(() => {
						closeCreateUserNotificationPlatformModal();
						createForm.reset();
					})}
				>
					<input hidden name="lot" value={createForm.values.lot} />
					<Stack>
						<Select
							required
							searchable
							label="Select a platform"
							data={convertEnumToSelectData(NotificationPlatformLot)}
							{...createForm.getInputProps("lot")}
						/>
						{createForm.values.lot
							? match(createForm.values.lot)
									.with(NotificationPlatformLot.Apprise, () => (
										<>
											<TextInput label="Base Url" required name="baseUrl" />
											<TextInput label="Key" required name="apiToken" />
										</>
									))
									.with(NotificationPlatformLot.Discord, () => (
										<>
											<TextInput label="Webhook Url" required name="baseUrl" />
										</>
									))
									.with(NotificationPlatformLot.Gotify, () => (
										<>
											<TextInput label="Server Url" required name="baseUrl" />
											<TextInput label="Token" required name="apiToken" />
											<NumberInput label="Priority" name="priority" />
										</>
									))
									.with(NotificationPlatformLot.Ntfy, () => (
										<>
											<TextInput label="Topic" required name="apiToken" />
											<TextInput label="Server Url" name="baseUrl" />
											<TextInput
												label="Access token"
												description={
													<>
														If you want to publish to a{" "}
														<Anchor
															size="xs"
															href="https://docs.ntfy.sh/publish/#access-tokens"
															target="_blank"
														>
															protected topic
														</Anchor>
													</>
												}
												name="authHeader"
											/>
											<NumberInput label="Priority" name="priority" />
										</>
									))
									.with(NotificationPlatformLot.PushBullet, () => (
										<>
											<TextInput label="Token" required name="apiToken" />
										</>
									))
									.with(NotificationPlatformLot.PushOver, () => (
										<>
											<TextInput label="User Key" required name="apiToken" />
											<TextInput label="App Key" name="authHeader" />
										</>
									))
									.with(NotificationPlatformLot.PushSafer, () => (
										<>
											<TextInput label="Key" required name="apiToken" />
										</>
									))
									.with(NotificationPlatformLot.Telegram, () => (
										<>
											<TextInput label="Bot Token" required name="apiToken" />
											<TextInput label="Chat ID" required name="chatId" />
										</>
									))
									.exhaustive()
							: null}
						<Button type="submit">Submit</Button>
					</Stack>
				</Box>
			</Modal>
			<Container size="xs">
				<Stack>
					<Title>Notification settings</Title>
					{loaderData.userNotificationPlatforms.length > 0 ? (
						loaderData.userNotificationPlatforms.map((notification) => (
							<DisplayNotification
								key={notification.id}
								notification={notification}
							/>
						))
					) : (
						<Text>No notification platforms configured</Text>
					)}
					<Flex justify="end">
						<Group>
							{loaderData.userNotificationPlatforms.length > 0 ? (
								<Form
									replace
									method="POST"
									action={withQuery(".", { intent: "test" })}
								>
									<Button size="xs" variant="light" color="green" type="submit">
										Trigger test notifications
									</Button>
								</Form>
							) : null}
							<Button
								size="xs"
								variant="light"
								onClick={openCreateUserNotificationPlatformModal}
							>
								Add notification platform
							</Button>
						</Group>
					</Flex>
				</Stack>
			</Container>
		</>
	);
}

const DisplayNotification = (props: {
	notification: UserNotificationPlatformsQuery["userNotificationPlatforms"][number];
}) => {
	const submit = useConfirmSubmit();
	const [editModalOpened, { open: openEditModal, close: closeEditModal }] =
		useDisclosure(false);
	const [isAdvancedSettingsOpen, { toggle: toggleAdvancedSettings }] =
		useDisclosure(false);
	const [configuredEvents, configuredEventsHandler] =
		useListState<UserNotificationContentDiscriminants>(
			props.notification.configuredEvents,
		);

	return (
		<>
			<Modal
				centered
				opened={editModalOpened}
				onClose={closeEditModal}
				title="Edit Notification"
			>
				<Form method="POST" action={withQuery(".", { intent: "update" })}>
					<input
						hidden
						name="notificationId"
						defaultValue={props.notification.id}
					/>
					<input
						hidden
						name="configuredEvents"
						value={configuredEvents.join(",")}
					/>
					<Stack>
						<Switch
							name="isDisabled"
							label="Disable notification"
							defaultChecked={props.notification.isDisabled ?? false}
						/>
						<Flex justify="end">
							<Anchor c="blue" size="xs" onClick={toggleAdvancedSettings}>
								{isAdvancedSettingsOpen ? "Hide" : "Show"} advanced settings
							</Anchor>
						</Flex>
						<Collapse in={isAdvancedSettingsOpen}>
							<Stack gap="xs">
								{Object.values(UserNotificationContentDiscriminants).map(
									(name) => (
										<Switch
											size="xs"
											key={name}
											defaultChecked={props.notification.configuredEvents.includes(
												name,
											)}
											onChange={(value) => {
												const checked = value.target.checked;
												if (checked) configuredEventsHandler.append(name);
												else
													configuredEventsHandler.filter(
														(event) => event !== name,
													);
											}}
											label={match(name)
												.with(
													UserNotificationContentDiscriminants.OutdatedSeenEntries,
													() =>
														"Media has been in progress/on hold for too long",
												)
												.with(
													UserNotificationContentDiscriminants.MetadataEpisodeNameChanged,
													() => "Name of an episode changes",
												)
												.with(
													UserNotificationContentDiscriminants.MetadataEpisodeImagesChanged,
													() => "Images for an episode change",
												)
												.with(
													UserNotificationContentDiscriminants.MetadataEpisodeReleased,
													() => "An episode is released",
												)
												.with(
													UserNotificationContentDiscriminants.MetadataPublished,

													() => "A media is published",
												)
												.with(
													UserNotificationContentDiscriminants.MetadataStatusChanged,
													() => "Status changes",
												)
												.with(
													UserNotificationContentDiscriminants.MetadataReleaseDateChanged,
													() => "Release date changes",
												)
												.with(
													UserNotificationContentDiscriminants.MetadataNumberOfSeasonsChanged,
													() => "Number of seasons changes",
												)
												.with(
													UserNotificationContentDiscriminants.MetadataChaptersOrEpisodesChanged,
													() =>
														"Number of chapters/episodes changes for manga/anime",
												)
												.with(
													UserNotificationContentDiscriminants.ReviewPosted,
													() =>
														"A new public review is posted for media/people you monitor",
												)
												.with(
													UserNotificationContentDiscriminants.PersonMetadataAssociated,
													() => "New media is associated with a person",
												)
												.with(
													UserNotificationContentDiscriminants.PersonMetadataGroupAssociated,
													() => "New media group is associated with a person",
												)
												.with(
													UserNotificationContentDiscriminants.NotificationFromReminderCollection,
													() =>
														"When an item is added to the reminder collection",
												)
												.with(
													UserNotificationContentDiscriminants.NewWorkoutCreated,
													() => "A new workout is created",
												)
												.with(
													UserNotificationContentDiscriminants.IntegrationDisabledDueToTooManyErrors,
													() => "Integration disabled due to too many errors",
												)
												.with(
													UserNotificationContentDiscriminants.MetadataMovedFromCompletedToWatchlistCollection,
													() =>
														"Media moved from the Completed to the Watchlist collection",
												)
												.exhaustive()}
										/>
									),
								)}
							</Stack>
						</Collapse>
						<Button type="submit" onClick={closeEditModal}>
							Save
						</Button>
					</Stack>
				</Form>
			</Modal>
			<Paper p="xs" withBorder>
				<Flex align="center" justify="space-between">
					<Box w="80%">
						<Text size="sm" truncate>
							<Text span fw="bold">
								{changeCase(props.notification.lot)}:
							</Text>{" "}
							<Text span>{props.notification.description}</Text>
						</Text>
						<Text size="xs">
							{[
								`Created: ${dayjsLib(props.notification.createdOn).fromNow()}`,
								props.notification.isDisabled && "Disabled",
								props.notification.configuredEvents.length > 0 &&
									`${props.notification.configuredEvents.length} events`,
							]
								.filter(Boolean)
								.join(" • ")}
						</Text>
					</Box>
					<Flex wrap="nowrap" gap={{ base: 2, md: "md" }} align="center">
						<ActionIcon color="indigo" variant="subtle" onClick={openEditModal}>
							<IconPencil />
						</ActionIcon>
						<Tooltip label="Delete">
							<Form
								method="POST"
								action={withQuery(".", { intent: "delete" })}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								<input
									hidden
									name="notificationId"
									defaultValue={props.notification.id}
								/>
								<ActionIcon
									type="submit"
									color="red"
									variant="subtle"
									onClick={(e) => {
										const form = e.currentTarget.form;
										e.preventDefault();
										openConfirmationModal(
											"Are you sure you want to delete this notification platform?",
											() => submit(form),
										);
									}}
								>
									<IconTrash />
								</ActionIcon>
							</Form>
						</Tooltip>
					</Flex>
				</Flex>
			</Paper>
		</>
	);
};
