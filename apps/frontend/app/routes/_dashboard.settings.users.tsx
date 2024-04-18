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
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useFetcher, useLoaderData } from "@remix-run/react";
import {
	DeleteUserDocument,
	RegisterErrorVariant,
	RegisterUserDocument,
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, randomString } from "@ryot/ts-utils";
import { IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getCoreDetails,
	gqlClient,
	processSubmission,
} from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreDetails, { usersList }] = await Promise.all([
		getCoreDetails(request),
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
				{ input: { password: submission } },
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
									RegisterErrorVariant.IdentifierAlreadyExists,
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
	const fetcher = useFetcher();
	const deleteFormRef = useRef<HTMLFormElement>(null);

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
					<Form
						replace
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
					</Form>
				</Modal>
				{loaderData.usersList.map((user) => (
					<Paper p="xs" withBorder key={user.id}>
						<Flex align="center" justify="space-between">
							<Box>
								<Text>{user.name}</Text>
								<Text size="xs">Role: {changeCase(user.lot)}</Text>
							</Box>
							<fetcher.Form
								action="?intent=delete"
								method="post"
								ref={deleteFormRef}
							>
								<input hidden name="toDeleteUserId" defaultValue={user.id} />
								<ActionIcon
									color="red"
									variant="outline"
									onClick={async () => {
										const conf = await confirmWrapper({
											confirmation:
												"Are you sure you want to delete this user?",
										});
										if (conf) fetcher.submit(deleteFormRef.current);
									}}
								>
									<IconTrash size={16} />
								</ActionIcon>
							</fetcher.Form>
						</Flex>
					</Paper>
				))}
			</Stack>
		</Container>
	);
}
