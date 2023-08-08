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
	Modal,
	Paper,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	DeleteUserDocument,
	type DeleteUserMutationVariables,
	RegisterUserDocument,
	type UserInput,
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, randomString } from "@ryot/ts-utils";
import { IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import { z } from "zod";

const registerFormSchema = z.object({
	username: z.string(),
	password: z.string(),
});
type RegisterUserFormSchema = z.infer<typeof registerFormSchema>;

const Page: NextPageWithLayout = () => {
	const [
		registerUserModalOpened,
		{ open: openRegisterUserModal, close: closeRegisterUserModal },
	] = useDisclosure(false);
	const registerUserForm = useForm<RegisterUserFormSchema>({
		validate: zodResolver(registerFormSchema),
	});

	const users = useQuery(["users"], async () => {
		const { usersList } = await gqlClient.request(UsersListDocument);
		return usersList;
	});

	const registerUser = useMutation({
		mutationFn: async (input: UserInput) => {
			const { registerUser } = await gqlClient.request(RegisterUserDocument, {
				input,
			});
			return registerUser;
		},
		onSuccess(data) {
			users.refetch();
			if (data.__typename === "RegisterError") {
				notifications.show({
					title: "Error with registration",
					message: data.error,
					color: "red",
				});
			} else {
				closeRegisterUserModal();
			}
		},
	});

	const deleteUser = useMutation({
		mutationFn: async (variables: DeleteUserMutationVariables) => {
			const { deleteUser } = await gqlClient.request(
				DeleteUserDocument,
				variables,
			);
			return deleteUser;
		},
		onSuccess: (data) => {
			if (data) {
				users.refetch();
				notifications.show({
					title: "Success",
					message: "User deleted successfully",
					color: "green",
				});
			} else {
				notifications.show({
					title: "Unsucessful",
					message: "There was a problem in deleting the user",
					color: "red",
				});
			}
		},
	});

	return users.data ? (
		<>
			<Head>
				<title>Users Settings | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Flex align={"center"} gap={"md"}>
						<Title>Users settings</Title>
						<ActionIcon
							color="green"
							variant="outline"
							onClick={() => {
								registerUserForm.reset();
								openRegisterUserModal();
							}}
						>
							<IconPlus size="1.25rem" />
						</ActionIcon>
					</Flex>
					<Modal
						opened={registerUserModalOpened}
						onClose={closeRegisterUserModal}
						withCloseButton={false}
						centered
					>
						<Box
							component="form"
							onSubmit={registerUserForm.onSubmit((values) => {
								registerUser.mutate(values);
								registerUserForm.reset();
								close();
							})}
						>
							<Stack>
								<Title order={3}>Create User</Title>
								<TextInput
									label="Name"
									required
									{...registerUserForm.getInputProps("username")}
								/>
								<TextInput
									label="Password"
									required
									rightSection={
										<ActionIcon
											onClick={() => {
												registerUserForm.setFieldValue(
													"password",
													randomString(5),
												);
											}}
										>
											<IconRefresh size="1rem" />
										</ActionIcon>
									}
									{...registerUserForm.getInputProps("password")}
								/>
								<Button variant="outline" type="submit">
									Create
								</Button>
							</Stack>
						</Box>
					</Modal>
					{users.data
						? users.data.map((user, idx) => (
								<Paper p="xs" withBorder key={idx}>
									<Flex align={"center"} justify={"space-between"}>
										<Box>
											<Text>{user.name}</Text>
											<Text size="xs">Role: {changeCase(user.lot)}</Text>
										</Box>
										<ActionIcon
											color={"red"}
											variant="outline"
											onClick={() => {
												const yes = confirm(
													"Are you sure you want to delete this user?",
												);
												if (yes)
													deleteUser.mutate({
														toDeleteUserId: user.id,
													});
											}}
										>
											<IconTrash size="1rem" />
										</ActionIcon>
									</Flex>
								</Paper>
						  ))
						: null}
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
