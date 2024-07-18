import { $path } from "@ignisda/remix-routes";
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
	PasswordInput,
	SimpleGrid,
	Stack,
	Switch,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	redirect,
	unstable_defineAction,
	unstable_defineLoader,
} from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import { Form, useLoaderData } from "@remix-run/react";
import {
	DeleteUserDocument,
	RegisterErrorVariant,
	RegisterUserDocument,
	UpdateUserDocument,
	UserLot,
	UsersListDocument,
	type UsersListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, randomString, truncate } from "@ryot/ts-utils";
import {
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { forwardRef, useState } from "react";
import { VirtuosoGrid } from "react-virtuoso";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import { useConfirmSubmit, useCoreDetails } from "~/lib/hooks";
import {
	createToastHeaders,
	getEnhancedCookieName,
	processSubmission,
	redirectIfNotAuthenticatedOrUpdated,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request }) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	if (userDetails.lot !== UserLot.Admin) throw redirect($path("/"));
	const cookieName = await getEnhancedCookieName("settings.users", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ usersList }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UsersListDocument, {
			query: query.query,
		}),
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
			const { deleteUser } = await serverGqlService.authenticatedRequest(
				request,
				DeleteUserDocument,
				submission,
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
			const { registerUser } = await serverGqlService.authenticatedRequest(
				request,
				RegisterUserDocument,
				{
					input: {
						adminAccessToken: submission.adminAccessToken,
						data: {
							password: {
								password: submission.password,
								username: submission.username,
							},
						},
					},
				},
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
		update: async () => {
			const submission = processSubmission(formData, updateUserSchema);
			submission.isDisabled = submission.isDisabled === true;
			await serverGqlService.authenticatedRequest(request, UpdateUserDocument, {
				input: submission,
			});
			return Response.json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "User updated successfully",
				}),
			});
		},
	});
});

const registerFormSchema = z.object({
	username: z.string(),
	password: z.string(),
	adminAccessToken: z.string().optional(),
});

const deleteSchema = z.object({ toDeleteUserId: z.string() });

const updateUserSchema = z.object({
	userId: z.string(),
	adminAccessToken: z.string(),
	isDisabled: zx.CheckboxAsString.optional(),
	lot: z.nativeEnum(UserLot).optional(),
	password: z.string().optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
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
							{!coreDetails.signupAllowed ? (
								<TextInput
									required
									name="adminAccessToken"
									label="Admin Access Token"
									description="This is required as registration is disabled"
								/>
							) : null}
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

type User = UsersListQuery["usersList"][number];

const UserDisplay = (props: { index: number }) => {
	const loaderData = useLoaderData<typeof loader>();
	const user = loaderData.usersList[props.index];
	const submit = useConfirmSubmit();
	const [updateUserData, setUpdateUserData] = useState<User | null>(null);

	if (!user) return null;

	return (
		<Paper p="xs" withBorder key={user.id} data-user-id={user.id}>
			<UpdateUserModal
				updateUserData={updateUserData}
				closeIntegrationModal={() => setUpdateUserData(null)}
			/>
			<Flex align="center" justify="space-between">
				<Group wrap="nowrap">
					<Avatar name={user.name} />
					<Box>
						<Text lineClamp={1} fw="bold">
							{truncate(user.name, { length: 20 })}
						</Text>
						<Text size="xs">
							Role: {changeCase(user.lot)}
							{user.isDisabled ? ", Status: Disabled" : null}
						</Text>
					</Box>
				</Group>
				<Group>
					<ActionIcon
						color="indigo"
						variant="outline"
						onClick={() => setUpdateUserData(user)}
					>
						<IconPencil />
					</ActionIcon>
					<Form
						method="POST"
						action={withQuery("", { intent: "delete" })}
						style={{ flex: "none" }}
					>
						<input hidden name="toDeleteUserId" defaultValue={user.id} />
						<ActionIcon
							color="red"
							type="submit"
							variant="outline"
							onClick={async (e) => {
								const form = e.currentTarget.form;
								e.preventDefault();
								const conf = await confirmWrapper({
									confirmation: "Are you sure you want to delete this user?",
								});
								if (conf && form) submit(form);
							}}
						>
							<IconTrash size={16} />
						</ActionIcon>
					</Form>
				</Group>
			</Flex>
		</Paper>
	);
};

const UpdateUserModal = (props: {
	updateUserData: User | null;
	closeIntegrationModal: () => void;
}) => {
	return (
		<Modal
			opened={props.updateUserData !== null}
			onClose={props.closeIntegrationModal}
			centered
			withCloseButton={false}
		>
			<Form
				replace
				method="POST"
				onSubmit={() => props.closeIntegrationModal()}
				action={withQuery("", { intent: "update" })}
			>
				<input hidden name="userId" defaultValue={props.updateUserData?.id} />
				<Stack>
					<Title order={3}>Update {props.updateUserData?.name}</Title>
					<TextInput
						required
						name="adminAccessToken"
						label="Admin Access Token"
						description="This is required as registration is disabled"
					/>
					<Switch
						label="Is disabled"
						name="isDisabled"
						description="This will disable the user from logging in"
						defaultChecked={props.updateUserData?.isDisabled || undefined}
					/>
					<PasswordInput name="password" label="Password" />
					<Button type="submit">Submit</Button>
				</Stack>
			</Form>
		</Modal>
	);
};
