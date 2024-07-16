import {
	ActionIcon,
	Avatar,
	Box,
	Button,
	Container,
	Flex,
	Group,
	Modal,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import { Form, useFetcher, useLoaderData } from "@remix-run/react";
import {
	DeleteUserDocument,
	RegisterErrorVariant,
	RegisterUserDocument,
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, randomString, truncate } from "@ryot/ts-utils";
import { IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { forwardRef, useRef, useState } from "react";
import { VirtuosoGrid } from "react-virtuoso";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import {
	createToastHeaders,
	enhancedServerGqlService,
	getAuthorizationHeader,
	getEnhancedCookieName,
	processSubmission,
	redirectUsingEnhancedCookieSearchParams,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request }) => {
	const cookieName = await getEnhancedCookieName("settings.users", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ usersList }] = await Promise.all([
		enhancedServerGqlService.request(
			UsersListDocument,
			{ query: query.query },
			getAuthorizationHeader(request),
		),
	]);
	return { usersList, query, cookieName };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "User Settings | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		delete: async () => {
			const submission = processSubmission(formData, deleteSchema);
			const { deleteUser } = await enhancedServerGqlService.request(
				DeleteUserDocument,
				submission,
				getAuthorizationHeader(request),
			);
			return Response.json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: deleteUser ? "success" : "error",
					message: deleteUser
						? "User deleted successfully"
						: "User can not be deleted",
				}),
			});
		},
		registerNew: async () => {
			const submission = processSubmission(formData, registerFormSchema);
			const { registerUser } = await enhancedServerGqlService.request(
				RegisterUserDocument,
				{ input: { password: submission } },
				getAuthorizationHeader(request),
			);
			const success = registerUser.__typename === "StringIdObject";
			return Response.json({ status: "success", submission } as const, {
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
});

const registerFormSchema = z.object({
	username: z.string(),
	password: z.string(),
});

const deleteSchema = z.object({ toDeleteUserId: z.string() });

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [
		registerUserModalOpened,
		{ open: openRegisterUserModal, close: closeRegisterUserModal },
	] = useDisclosure(false);
	const [password, setPassword] = useState("");

	return (
		<Container size="lg">
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
					<Form replace method="POST" onSubmit={closeRegisterUserModal}>
						<input hidden name="intent" defaultValue="registerNew" />
						<Stack>
							<Title order={3}>Create User</Title>
							<TextInput label="Name" required name="username" />
							<TextInput
								required
								name="password"
								label="Password"
								value={password}
								onChange={(e) => setPassword(e.currentTarget.value)}
								rightSection={
									<ActionIcon onClick={() => setPassword(randomString(7))}>
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
				<DebouncedSearchInput
					placeholder="Search for users"
					initialValue={loaderData.query.query}
					enhancedQueryParams={loaderData.cookieName}
				/>

				<VirtuosoGrid
					components={{
						List: forwardRef((props, ref) => (
							<SimpleGrid ref={ref} {...props} cols={{ md: 2, xl: 3 }} />
						)),
					}}
					style={{ height: "70vh" }}
					totalCount={loaderData.usersList.length}
					itemContent={(index) => <UserDisplay index={index} />}
				/>
			</Stack>
		</Container>
	);
}

const UserDisplay = (props: { index: number }) => {
	const loaderData = useLoaderData<typeof loader>();
	const fetcher = useFetcher<typeof action>();
	const deleteFormRef = useRef<HTMLFormElement>(null);
	const user = loaderData.usersList[props.index];
	if (!user) return null;

	return (
		<Paper p="xs" withBorder key={user.id} data-user-id={user.id}>
			<Flex align="center" justify="space-between">
				<Group wrap="nowrap">
					<Avatar name={user.name} />
					<Box>
						<Text lineClamp={1} fw="bold">
							{truncate(user.name, { length: 20 })}
						</Text>
						<Text size="xs">Role: {changeCase(user.lot)}</Text>
					</Box>
				</Group>
				<fetcher.Form
					method="POST"
					ref={deleteFormRef}
					action={withQuery("", { intent: "delete" })}
					style={{ flex: "none" }}
				>
					<input hidden name="toDeleteUserId" defaultValue={user.id} />
					<ActionIcon
						color="red"
						variant="outline"
						onClick={async () => {
							const conf = await confirmWrapper({
								confirmation: "Are you sure you want to delete this user?",
							});
							if (conf) fetcher.submit(deleteFormRef.current);
						}}
					>
						<IconTrash size={16} />
					</ActionIcon>
				</fetcher.Form>
			</Flex>
		</Paper>
	);
};
