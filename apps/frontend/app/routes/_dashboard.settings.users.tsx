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
import { useDisclosure } from "@mantine/hooks";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	DeleteUserDocument,
	RegisterErrorVariant,
	RegisterUserDocument,
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, randomString } from "@ryot/ts-utils";
import { IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreDetails, { usersList }] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(
			UsersListDocument,
			undefined,
			await getAuthorizationHeader(request),
		),
	]);
	return json({ coreDetails, usersList });
};

export const meta: MetaFunction = () => {
	return [{ title: "User Settings | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		delete: async () => {
			const submission = processSubmission(formData, deleteSchema);
			const { deleteUser } = await gqlClient.request(
				DeleteUserDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: deleteUser ? "success" : "error",
					message: deleteUser
						? "User deleted successfully"
						: "User can not be deleted",
				}),
			});
		},
		register: async () => {
			const submission = processSubmission(formData, registerFormSchema);
			const { registerUser } = await gqlClient.request(
				RegisterUserDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			const success = registerUser.__typename === "IdObject";
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: success ? "success" : "error",
					message: success
						? "User registered successfully"
						: match(registerUser.error)
								.with(
									RegisterErrorVariant.Disabled,
									() => "Registration is disabled",
								)
								.with(
									RegisterErrorVariant.UsernameAlreadyExists,
									() => "Username already exists",
								)
								.exhaustive(),
				}),
			});
		},
	});
};

const registerFormSchema = z.object({
	username: z.string(),
	password: z.string(),
});

const deleteSchema = z.object({ toDeleteUserId: zx.IntAsString });

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [
		registerUserModalOpened,
		{ open: openRegisterUserModal, close: closeRegisterUserModal },
	] = useDisclosure(false);
	const [password, setPassword] = useState("");

	return (
		<Container size="xs">
			<Stack>
				<Flex align="center" gap="md">
					<Title>Users settings</Title>
					<ActionIcon
						color="green"
						variant="outline"
						onClick={() => {
							openRegisterUserModal();
						}}
					>
						<IconPlus size={20} />
					</ActionIcon>
				</Flex>
				<Modal
					opened={registerUserModalOpened}
					onClose={closeRegisterUserModal}
					withCloseButton={false}
					centered
				>
					<Box
						component={Form}
						onSubmit={closeRegisterUserModal}
						method="post"
						action="?intent=register"
					>
						<Stack>
							<Title order={3}>Create User</Title>
							<TextInput label="Name" required name="username" />
							<TextInput
								label="Password"
								required
								name="password"
								value={password}
								onChange={(e) => setPassword(e.currentTarget.value)}
								rightSection={
									<ActionIcon
										onClick={() => {
											setPassword(randomString(7));
										}}
									>
										<IconRefresh size={16} />
									</ActionIcon>
								}
							/>
							<Button variant="outline" type="submit">
								Create
							</Button>
						</Stack>
					</Box>
				</Modal>
				{loaderData.usersList.map((user) => (
					<Paper p="xs" withBorder key={user.id}>
						<Flex align="center" justify="space-between">
							<Box>
								<Text>{user.name}</Text>
								<Text size="xs">Role: {changeCase(user.lot)}</Text>
							</Box>
							<Form action="?intent=delete" method="post">
								<ActionIcon
									color="red"
									variant="outline"
									type="submit"
									name="toDeleteUserId"
									value={user.id}
									onClick={(e) => {
										if (!confirm("Are you sure you want to delete this user?"))
											e.preventDefault();
									}}
								>
									<IconTrash size={16} />
								</ActionIcon>
							</Form>
						</Flex>
					</Paper>
				))}
			</Stack>
		</Container>
	);
}
