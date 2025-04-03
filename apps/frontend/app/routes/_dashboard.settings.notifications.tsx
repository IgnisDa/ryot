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
import { useDisclosure, useListState } from "@mantine/hooks";
import {
	CreateUserNotificationPlatformDocument,
	DeleteUserNotificationPlatformDocument,
	NotificationPlatformLot,
	TestUserNotificationPlatformsDocument,
	UpdateUserNotificationPlatformDocument,
	UserNotificationContent,
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
import { useState } from "react";
import { Form, useLoaderData } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import {
	dayjsLib,
	openConfirmationModal,
	zodCommaDelimitedString,
} from "~/lib/common";
import { useConfirmSubmit } from "~/lib/hooks";
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
			return Response.json({ status: "success", submission } as const);
		})
		.with("delete", async () => {
			const submission = processSubmission(formData, deleteSchema);
			await serverGqlService.authenticatedRequest(
				request,
				DeleteUserNotificationPlatformDocument,
				submission,
			);
			return Response.json({ status: "success", submission } as const, {
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
			return Response.json({ status: "success" } as const, {
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
			return Response.json({ status: "success", submission } as const, {
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
	lot: z.nativeEnum(NotificationPlatformLot),
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
		(v) => v as UserNotificationContent[],
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
	const [
		createUserNotificationPlatformLot,
		setCreateUserNotificationPlatformLot,
	] = useState<NotificationPlatformLot>();

	return (
		<>
			<Modal
				opened={createUserNotificationPlatformModalOpened}
				onClose={closeCreateUserNotificationPlatformModal}
				centered
				withCloseButton={false}
			>
				<Box
					method="POST"
					component={Form}
					action={withQuery(".", { intent: "create" })}
					onSubmit={() => {
						closeCreateUserNotificationPlatformModal();
						setCreateUserNotificationPlatformLot(undefined);
					}}
				>
					<input hidden name="lot" value={createUserNotificationPlatformLot} />
					<Stack>
						<Select
							required
							searchable
							label="Select a platform"
							data={Object.values(NotificationPlatformLot).map((v) => ({
								label: changeCase(v),
								value: v,
							}))}
							onChange={(v) => {
								if (v)
									setCreateUserNotificationPlatformLot(
										v as NotificationPlatformLot,
									);
							}}
						/>
						{createUserNotificationPlatformLot
							? match(createUserNotificationPlatformLot)
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
		useListState<UserNotificationContent>(props.notification.configuredEvents);

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
								{Object.values(UserNotificationContent).map((name) => (
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
												UserNotificationContent.OutdatedSeenEntries,
												() => "Media has been in progress/on hold for too long",
											)
											.with(
												UserNotificationContent.MetadataEpisodeNameChanged,
												() => "Name of an episode changes",
											)
											.with(
												UserNotificationContent.MetadataEpisodeImagesChanged,
												() => "Images for an episode changes",
											)
											.with(
												UserNotificationContent.MetadataEpisodeReleased,
												() => "Number of episodes changes",
											)
											.with(
												UserNotificationContent.MetadataPublished,

												() => "A media is published",
											)
											.with(
												UserNotificationContent.MetadataStatusChanged,
												() => "Status changes",
											)
											.with(
												UserNotificationContent.MetadataReleaseDateChanged,
												() => "Release date changes",
											)
											.with(
												UserNotificationContent.MetadataNumberOfSeasonsChanged,
												() => "Number of seasons changes",
											)
											.with(
												UserNotificationContent.MetadataChaptersOrEpisodesChanged,
												() =>
													"Number of chapters/episodes changes for manga/anime",
											)
											.with(
												UserNotificationContent.ReviewPosted,
												() =>
													"A new public review is posted for media/people you monitor",
											)
											.with(
												UserNotificationContent.PersonMetadataAssociated,
												() => "New media is associated with a person",
											)
											.with(
												UserNotificationContent.PersonMetadataGroupAssociated,
												() => "New media group is associated with a person",
											)
											.with(
												UserNotificationContent.NotificationFromReminderCollection,
												() =>
													"When an item is added to the reminder collection",
											)
											.with(
												UserNotificationContent.NewWorkoutCreated,
												() => "A new workout is created",
											)
											.with(
												UserNotificationContent.IntegrationDisabledDueToTooManyErrors,
												() => "Integration disabled due to too many errors",
											)
											.with(
												UserNotificationContent.EntityRemovedFromMonitoringCollection,
												() =>
													"An entity is removed from the monitoring collection",
											)
											.exhaustive()}
									/>
								))}
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
