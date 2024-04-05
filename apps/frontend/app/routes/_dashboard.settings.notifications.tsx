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
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useFetcher, useLoaderData } from "@remix-run/react";
import {
	CreateUserNotificationPlatformDocument,
	DeleteUserNotificationPlatformDocument,
	TestUserNotificationPlatformsDocument,
	UserNotificationPlatformsDocument,
	type UserNotificationPlatformsQuery,
	UserNotificationSettingKind,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconTrash } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import { dayjsLib } from "~/lib/generals";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getCoreDetails,
	gqlClient,
	processSubmission,
} from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreDetails, { userNotificationPlatforms }] = await Promise.all([
		getCoreDetails(request),
		gqlClient.request(
			UserNotificationPlatformsDocument,
			undefined,
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		userNotificationPlatforms,
		coreDetails: { docsLink: coreDetails.docsLink },
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Notification Settings | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		create: async () => {
			const submission = processSubmission(formData, createSchema);
			await gqlClient.request(
				CreateUserNotificationPlatformDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const);
		},
		delete: async () => {
			const submission = processSubmission(formData, deleteSchema);
			await gqlClient.request(
				DeleteUserNotificationPlatformDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Notification platform deleted successfully",
				}),
			});
		},
		test: async () => {
			const { testUserNotificationPlatforms } = await gqlClient.request(
				TestUserNotificationPlatformsDocument,
				undefined,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success" } as const, {
				headers: await createToastHeaders({
					type: testUserNotificationPlatforms ? "success" : "error",
					message: testUserNotificationPlatforms
						? "Please check your notification platforms"
						: "Something went wrong",
				}),
			});
		},
	});
};

const deleteSchema = z.object({ notificationId: zx.NumAsString });

const createSchema = z.object({
	lot: z.nativeEnum(UserNotificationSettingKind),
	baseUrl: z
		.string()
		.url()
		.refine((val) => !val.endsWith("/"), {
			message: "Trailing slash not allowed",
		})
		.optional(),
	apiToken: z.string().optional(),
	authHeader: z.string().optional(),
	priority: z.number().optional(),
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
	] = useState<UserNotificationSettingKind>();

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
								<Form action="?intent=test" method="post" replace>
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
							component={Form}
							action="?intent=create"
							method="post"
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
									data={Object.values(UserNotificationSettingKind).map((v) => ({
										label: changeCase(v),
										value: v,
									}))}
									onChange={(v) => {
										if (v)
											setCreateUserNotificationPlatformLot(
												v as UserNotificationSettingKind,
											);
									}}
								/>
								{createUserNotificationPlatformLot
									? match(createUserNotificationPlatformLot)
											.with(UserNotificationSettingKind.Apprise, () => (
												<>
													<TextInput label="Base Url" required name="baseUrl" />
													<TextInput label="Key" required name="apiToken" />
												</>
											))
											.with(UserNotificationSettingKind.Discord, () => (
												<>
													<TextInput
														label="Webhook Url"
														required
														name="baseUrl"
													/>
												</>
											))
											.with(UserNotificationSettingKind.Gotify, () => (
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
											.with(UserNotificationSettingKind.Ntfy, () => (
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
											.with(UserNotificationSettingKind.PushBullet, () => (
												<>
													<TextInput label="Token" required name="apiToken" />
												</>
											))
											.with(UserNotificationSettingKind.PushOver, () => (
												<>
													<TextInput
														label="User Key"
														required
														name="apiToken"
													/>
													<TextInput label="App Key" name="authHeader" />
												</>
											))
											.with(UserNotificationSettingKind.PushSafer, () => (
												<>
													<TextInput label="Key" required name="apiToken" />
												</>
											))
											.with(UserNotificationSettingKind.Email, () => (
												<>
													<TextInput
														type="email"
														label="Email ID"
														required
														name="apiToken"
														description={
															<>
																Make sure
																<Anchor
																	size="xs"
																	href={`${loaderData.coreDetails.docsLink}/configuration.html?h=smtp#all-parameters`}
																	target="_blank"
																>
																	{" "}
																	the correct{" "}
																</Anchor>
																configuration parameters are set
															</>
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
	const fetcher = useFetcher();
	const deleteFormRef = useRef<HTMLFormElement>(null);
	return (
		<Paper p="xs" withBorder>
			<Flex align="center" justify="space-between">
				<Box w="80%">
					<Text size="xs" lineClamp={1}>
						{props.notification.description}
					</Text>
					<Text size="xs">
						{dayjsLib(props.notification.timestamp).fromNow()}
					</Text>
				</Box>
				<Group>
					<Tooltip label="Delete">
						<fetcher.Form
							action="?intent=delete"
							method="post"
							ref={deleteFormRef}
						>
							<input
								hidden
								name="notificationId"
								defaultValue={props.notification.id}
							/>
							<ActionIcon
								color="red"
								variant="outline"
								onClick={async () => {
									const conf = await confirmWrapper({
										confirmation:
											"Are you sure you want to delete this notification platform?",
									});
									if (conf) fetcher.submit(deleteFormRef.current);
								}}
							>
								<IconTrash size={16} />
							</ActionIcon>
						</fetcher.Form>
					</Tooltip>
				</Group>
			</Flex>
		</Paper>
	);
};
