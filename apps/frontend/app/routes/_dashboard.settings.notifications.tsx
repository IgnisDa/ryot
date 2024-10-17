import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Container,
	Flex,
	Group,
	Modal,
	NumberInput,
	Paper,
	Select,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	type MetaArgs_SingleFetch,
	useLoaderData,
} from "@remix-run/react";
import {
	CreateUserNotificationPlatformDocument,
	DeleteUserNotificationPlatformDocument,
	NotificationPlatformLot,
	TestUserNotificationPlatformsDocument,
	UpdateUserNotificationPlatformDocument,
	UserNotificationPlatformsDocument,
	type UserNotificationPlatformsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, processSubmission } from "@ryot/ts-utils";
import {
	IconPlayerPause,
	IconPlayerPlay,
	IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import { dayjsLib } from "~/lib/generals";
import { useConfirmSubmit, useCoreDetails } from "~/lib/hooks";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";

export const loader = unstable_defineLoader(async ({ request }) => {
	const [{ userNotificationPlatforms }] = await Promise.all([
		serverGqlService.authenticatedRequest(
			request,
			UserNotificationPlatformsDocument,
			{},
		),
	]);
	return { userNotificationPlatforms };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Notification Settings | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		create: async () => {
			const submission = processSubmission(formData, createSchema);
			await serverGqlService.authenticatedRequest(
				request,
				CreateUserNotificationPlatformDocument,
				{ input: submission },
			);
			return Response.json({ status: "success", submission } as const);
		},
		delete: async () => {
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
		},
		test: async () => {
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
		},
		update: async () => {
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
		},
	});
});

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
	isDisabled: zx.BoolAsString.optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
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
				<Box>
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
							<input
								hidden
								name="lot"
								value={createUserNotificationPlatformLot}
							/>
							<Stack>
								<Select
									label="Select a platform"
									required
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
													<TextInput
														label="Webhook Url"
														required
														name="baseUrl"
													/>
												</>
											))
											.with(NotificationPlatformLot.Gotify, () => (
												<>
													<TextInput
														label="Server Url"
														required
														name="baseUrl"
													/>
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
													<TextInput
														label="User Key"
														required
														name="apiToken"
													/>
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
													<TextInput
														label="Bot Token"
														required
														name="apiToken"
													/>
													<TextInput label="Chat ID" required name="chatId" />
												</>
											))
											.with(NotificationPlatformLot.Email, () => (
												<>
													<TextInput
														type="email"
														label="Email ID"
														required
														name="apiToken"
														disabled={!coreDetails.smtpEnabled}
														description={
															coreDetails.smtpEnabled
																? null
																: "SMTP is not enabled"
														}
													/>
												</>
											))
											.exhaustive()
									: null}
								<Button type="submit">Submit</Button>
							</Stack>
						</Box>
					</Modal>
				</Box>
			</Stack>
		</Container>
	);
}

const DisplayNotification = (props: {
	notification: UserNotificationPlatformsQuery["userNotificationPlatforms"][number];
}) => {
	const submit = useConfirmSubmit();

	return (
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
						Created: {dayjsLib(props.notification.createdOn).fromNow()}
					</Text>
				</Box>
				<Group>
					<Form method="POST" action={withQuery(".", { intent: "update" })}>
						<ActionIcon color="indigo" variant="subtle" type="submit">
							{props.notification.isDisabled ? (
								<IconPlayerPlay />
							) : (
								<IconPlayerPause />
							)}
							<input
								hidden
								name="notificationId"
								defaultValue={props.notification.id}
							/>
							<input
								hidden
								readOnly
								name="isDisabled"
								value={props.notification.isDisabled ? "false" : "true"}
							/>
						</ActionIcon>
					</Form>
					<Tooltip label="Delete">
						<Form method="POST" action={withQuery(".", { intent: "delete" })}>
							<input
								hidden
								name="notificationId"
								defaultValue={props.notification.id}
							/>
							<ActionIcon
								type="submit"
								color="red"
								variant="subtle"
								onClick={async (e) => {
									const form = e.currentTarget.form;
									e.preventDefault();
									const conf = await confirmWrapper({
										confirmation:
											"Are you sure you want to delete this notification platform?",
									});
									if (conf && form) submit(form);
								}}
							>
								<IconTrash />
							</ActionIcon>
						</Form>
					</Tooltip>
				</Group>
			</Flex>
		</Paper>
	);
};
