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
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	UserNotificationPlatformsDocument,
	UserNotificationSettingKind,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconTrash } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { match } from "ts-pattern";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [{ userNotificationPlatforms }] = await Promise.all([
		gqlClient.request(
			UserNotificationPlatformsDocument,
			undefined,
			await getAuthorizationHeader(request),
		),
	]);
	return json({ userNotificationPlatforms });
};

export const meta: MetaFunction = () => {
	return [{ title: "Notification Settings | Ryot" }];
};

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
					loaderData.userNotificationPlatforms.map((not) => (
						<Paper p="xs" withBorder key={not.id}>
							<Flex align="center" justify="space-between">
								<Box w="80%">
									<Text size="xs" lineClamp={1}>
										{not.description}
									</Text>
									<Text size="xs">
										{DateTime.fromISO(not.timestamp).toRelative()}
									</Text>
								</Box>
								<Group>
									<Tooltip label="Delete">
										<Form action="?delete" method="post">
											<ActionIcon
												color="red"
												variant="outline"
												type="submit"
												name="notificationId"
												value={not.id}
												onClick={(e) => {
													if (
														!confirm(
															"Are you sure you want to delete this notification platform?",
														)
													)
														e.preventDefault();
												}}
											>
												<IconTrash size={16} />
											</ActionIcon>
										</Form>
									</Tooltip>
								</Group>
							</Flex>
						</Paper>
					))
				) : (
					<Text>No notification platforms configured</Text>
				)}
				<Box>
					<Flex justify="end">
						<Group>
							{loaderData.userNotificationPlatforms.length > 0 ? (
								<Button
									size="xs"
									variant="light"
									color="green"
									onClick={() => testUserNotificationPlatforms.mutate({})}
								>
									Trigger test notifications
								</Button>
							) : undefined}
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
							action="?create"
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
									data={Object.values(UserNotificationSettingKind).map(
										(v) => ({ label: changeCase(v), value: v }),
									)}
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
													<TextInput
														label="Base Url"
														required
														{...createUserNotificationPlatformForm.getInputProps(
															"baseUrl",
														)}
													/>
													<TextInput
														label="Key"
														required
														{...createUserNotificationPlatformForm.getInputProps(
															"apiToken",
														)}
													/>
												</>
											))
											.with(UserNotificationSettingKind.Discord, () => (
												<>
													<TextInput
														label="Webhook Url"
														required
														{...createUserNotificationPlatformForm.getInputProps(
															"baseUrl",
														)}
													/>
												</>
											))
											.with(UserNotificationSettingKind.Gotify, () => (
												<>
													<TextInput
														label="Server Url"
														required
														{...createUserNotificationPlatformForm.getInputProps(
															"baseUrl",
														)}
													/>
													<TextInput
														label="Token"
														required
														{...createUserNotificationPlatformForm.getInputProps(
															"apiToken",
														)}
													/>
													<NumberInput
														label="Priority"
														{...createUserNotificationPlatformForm.getInputProps(
															"priority",
														)}
													/>
												</>
											))
											.with(UserNotificationSettingKind.Ntfy, () => (
												<>
													<TextInput
														label="Topic"
														required
														{...createUserNotificationPlatformForm.getInputProps(
															"apiToken",
														)}
													/>
													<TextInput
														label="Server Url"
														{...createUserNotificationPlatformForm.getInputProps(
															"baseUrl",
														)}
													/>
													<TextInput
														label="Access token"
														description={
															<>
																If you want to publish to a{" "}
																<Anchor
																	size="xs"
																	href="https://docs.ntfy.sh/publish/#access-tokens"
																	target="_blank"
																	rel="noopener noreferrer"
																>
																	protected topic
																</Anchor>
															</>
														}
														{...createUserNotificationPlatformForm.getInputProps(
															"authHeader",
														)}
													/>
													<NumberInput
														label="Priority"
														{...createUserNotificationPlatformForm.getInputProps(
															"priority",
														)}
													/>
												</>
											))
											.with(UserNotificationSettingKind.PushBullet, () => (
												<>
													<TextInput
														label="Token"
														required
														{...createUserNotificationPlatformForm.getInputProps(
															"apiToken",
														)}
													/>
												</>
											))
											.with(UserNotificationSettingKind.PushOver, () => (
												<>
													<TextInput
														label="User Key"
														required
														{...createUserNotificationPlatformForm.getInputProps(
															"apiToken",
														)}
													/>
													<TextInput
														label="App Key"
														{...createUserNotificationPlatformForm.getInputProps(
															"baseUrl",
														)}
													/>
												</>
											))
											.with(UserNotificationSettingKind.PushSafer, () => (
												<>
													<TextInput
														label="Key"
														required
														{...createUserNotificationPlatformForm.getInputProps(
															"apiToken",
														)}
													/>
												</>
											))
											.exhaustive()
									: undefined}
								<Button type="submit">Submit</Button>
							</Stack>
						</Box>
					</Modal>
				</Box>
			</Stack>
		</Container>
	);
}
