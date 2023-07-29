import type { NextPageWithLayout } from "../_app";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
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
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CreateUserNotificationPlatformDocument,
	type CreateUserNotificationPlatformMutationVariables,
	DeleteUserNotificationPlatformDocument,
	type DeleteUserNotificationPlatformMutationVariables,
	TestUserNotificationPlatformDocument,
	type TestUserNotificationPlatformMutationVariables,
	UserNotificationPlatformLot,
	UserNotificationPlatformsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatTimeAgo } from "@ryot/utilities";
import { IconPlayerPlay, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement, useState } from "react";
import { match } from "ts-pattern";
import { z } from "zod";

const createUserNotificationPlatformSchema = z.object({
	baseUrl: z.string().url().optional(),
	apiToken: z.string().optional(),
	priority: z.number().optional(),
});
type CreateUserNotificationPlatformSchema = z.infer<
	typeof createUserNotificationPlatformSchema
>;

const Page: NextPageWithLayout = () => {
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
	] = useState<UserNotificationPlatformLot>();

	const createUserNotificationPlatformForm =
		useForm<CreateUserNotificationPlatformSchema>({
			validate: zodResolver(createUserNotificationPlatformSchema),
		});

	const userNotificationPlatform = useQuery(
		["userNotificationPlatforms"],
		async () => {
			const { userNotificationPlatforms } = await gqlClient.request(
				UserNotificationPlatformsDocument,
			);
			return userNotificationPlatforms;
		},
	);

	const createUserNotificationPlatform = useMutation({
		mutationFn: async (
			variables: CreateUserNotificationPlatformMutationVariables,
		) => {
			const { createUserNotificationPlatform } = await gqlClient.request(
				CreateUserNotificationPlatformDocument,
				variables,
			);
			return createUserNotificationPlatform;
		},
		onSuccess: () => {
			userNotificationPlatform.refetch();
		},
	});

	const testUserNotificationPlatform = useMutation({
		mutationFn: async (
			variables: TestUserNotificationPlatformMutationVariables,
		) => {
			const { testUserNotificationPlatform } = await gqlClient.request(
				TestUserNotificationPlatformDocument,
				variables,
			);
			return testUserNotificationPlatform;
		},
		onSuccess: (data) => {
			if (data)
				notifications.show({
					color: "green",
					message: "Please check your notification platform",
				});
			else
				notifications.show({
					color: "red",
					message: "Error in sending notification",
				});
		},
	});

	const deleteUserNotificationPlatform = useMutation({
		mutationFn: async (
			variables: DeleteUserNotificationPlatformMutationVariables,
		) => {
			const { deleteUserNotificationPlatform } = await gqlClient.request(
				DeleteUserNotificationPlatformDocument,
				variables,
			);
			return deleteUserNotificationPlatform;
		},
		onSuccess: () => {
			userNotificationPlatform.refetch();
		},
	});

	return userNotificationPlatform.data ? (
		<>
			<Head>
				<title>Notifications Settings | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Notifications settings</Title>
					{userNotificationPlatform.data.length > 0 ? (
						userNotificationPlatform.data.map((notif, idx) => (
							<Paper p="xs" withBorder key={idx}>
								<Flex align={"center"} justify={"space-between"}>
									<Box w="80%">
										<Text size="xs" lineClamp={1}>
											{notif.description}
										</Text>
										<Text size="xs">{formatTimeAgo(notif.timestamp)}</Text>
									</Box>
									<Group>
										<ActionIcon
											color="green"
											variant="outline"
											onClick={() => {
												testUserNotificationPlatform.mutate({
													notificationId: notif.id,
												});
											}}
										>
											<IconPlayerPlay size="1rem" />
										</ActionIcon>
										<ActionIcon
											color="red"
											variant="outline"
											onClick={() => {
												const yes = confirm(
													"Are you sure you want to delete this notification platform?",
												);
												if (yes)
													deleteUserNotificationPlatform.mutate({
														notificationId: notif.id,
													});
											}}
										>
											<IconTrash size="1rem" />
										</ActionIcon>
									</Group>
								</Flex>
							</Paper>
						))
					) : (
						<Text>No notification platforms configured</Text>
					)}
					<Box ml="auto">
						<Button
							size="xs"
							variant="light"
							onClick={openCreateUserNotificationPlatformModal}
						>
							Add new notification platform
						</Button>
						<Modal
							opened={createUserNotificationPlatformModalOpened}
							onClose={closeCreateUserNotificationPlatformModal}
							centered
							withCloseButton={false}
						>
							<Box
								component="form"
								onSubmit={createUserNotificationPlatformForm.onSubmit(
									(values) => {
										if (createUserNotificationPlatformLot) {
											createUserNotificationPlatform.mutate({
												input: {
													lot: createUserNotificationPlatformLot,
													...values,
												},
											});
										}
										closeCreateUserNotificationPlatformModal();
										createUserNotificationPlatformForm.reset();
										setCreateUserNotificationPlatformLot(undefined);
									},
								)}
							>
								<Stack>
									<Select
										label="Select a platform"
										required
										withinPortal
										data={Object.values(UserNotificationPlatformLot).map(
											(v) => ({ label: changeCase(v), value: v }),
										)}
										onChange={(v) => {
											const t = match(v)
												.with(
													"DISCORD",
													() => UserNotificationPlatformLot.Discord,
												)
												.with(
													"GOTIFY",
													() => UserNotificationPlatformLot.Gotify,
												)
												.with("NTFY", () => UserNotificationPlatformLot.Ntfy)
												.with(
													"PUSH_BULLET",
													() => UserNotificationPlatformLot.PushBullet,
												)
												.with(
													"PUSH_OVER",
													() => UserNotificationPlatformLot.PushOver,
												)
												.with(
													"PUSH_SAFER",
													() => UserNotificationPlatformLot.PushSafer,
												)
												.otherwise(() => undefined);
											if (t) setCreateUserNotificationPlatformLot(t);
										}}
									/>
									{createUserNotificationPlatformLot
										? match(createUserNotificationPlatformLot)
												.with(UserNotificationPlatformLot.Discord, () => (
													<>
														<TextInput
															label="Base Url"
															required
															{...createUserNotificationPlatformForm.getInputProps(
																"baseUrl",
															)}
														/>
													</>
												))
												.with(UserNotificationPlatformLot.Gotify, () => (
													<>
														<TextInput
															label="Base Url"
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
															required
															{...createUserNotificationPlatformForm.getInputProps(
																"priority",
															)}
														/>
													</>
												))
												.with(UserNotificationPlatformLot.Ntfy, () => (
													<>
														<TextInput
															label="Base Url"
															required
															{...createUserNotificationPlatformForm.getInputProps(
																"baseUrl",
															)}
														/>
														<NumberInput
															label="Priority"
															required
															{...createUserNotificationPlatformForm.getInputProps(
																"priority",
															)}
														/>
													</>
												))
												.with(UserNotificationPlatformLot.PushBullet, () => (
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
												.with(UserNotificationPlatformLot.PushOver, () => (
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
												.with(UserNotificationPlatformLot.PushSafer, () => (
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
										: null}
									<Button
										type="submit"
										loading={createUserNotificationPlatform.isLoading}
									>
										Submit
									</Button>
								</Stack>
							</Box>
						</Modal>
					</Box>
				</Stack>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
