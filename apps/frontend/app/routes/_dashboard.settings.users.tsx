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
import { notifications } from "@mantine/notifications";
import {
	DeleteUserDocument,
	RegisterErrorVariant,
	RegisterUserDocument,
	UpdateUserDocument,
	UserLot,
	UsersListDocument,
	type UsersListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	getActionIntent,
	parseSearchQuery,
	processSubmission,
	truncate,
	zodCheckboxAsString,
} from "@ryot/ts-utils";
import {
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { forwardRef, useState } from "react";
import { Form, data, redirect, useLoaderData, useRevalidator } from "react-router";
import { VirtuosoGrid } from "react-virtuoso";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { DebouncedSearchInput } from "~/components/common";
import { clientGqlService, openConfirmationModal } from "~/lib/common";
import { useCoreDetails } from "~/lib/hooks";
import {
	createToastHeaders,
	getSearchEnhancedCookieName,
	redirectIfNotAuthenticatedOrUpdated,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.users";

const searchParamsSchema = z.object({
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	if (userDetails.lot !== UserLot.Admin) throw redirect($path("/"));
	const cookieName = await getSearchEnhancedCookieName(
		"settings.users",
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseSearchQuery(request, searchParamsSchema);
	const [{ usersList }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UsersListDocument, {
			query: query.query,
		}),
	]);
	return { usersList, query, cookieName };
};

export const meta = () => {
	return [{ title: "User Settings | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("registerNew", async () => {
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
			return data({ status: "success", submission } as const, {
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
		})
		.with("update", async () => {
			const submission = processSubmission(formData, updateUserSchema);
			submission.isDisabled = submission.isDisabled === true;
			await serverGqlService.authenticatedRequest(request, UpdateUserDocument, {
				input: submission,
			});
			return data({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "User updated successfully",
				}),
			});
		})
		.run();
};

const registerFormSchema = z.object({
	username: z.string(),
	password: z.string(),
	adminAccessToken: z.string().optional(),
});

const updateUserSchema = z.object({
	userId: z.string(),
	adminAccessToken: z.string(),
	password: z.string().optional(),
	lot: z.nativeEnum(UserLot).optional(),
	isDisabled: zodCheckboxAsString.optional(),
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
					<Form
						replace
						method="POST"
						onSubmit={closeRegisterUserModal}
						action={withQuery(".", { intent: "registerNew" })}
					>
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
									<ActionIcon onClick={() => setPassword(nanoid(7))}>
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
					placeholder="Search by name or ID"
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
	const revalidator = useRevalidator();
	const [updateUserData, setUpdateUserData] = useState<User | null>(null);

	const deleteUserMutation = useMutation({
		mutationFn: async (toDeleteUserId: string) => {
			const { deleteUser } = await clientGqlService.request(
				DeleteUserDocument,
				{ toDeleteUserId },
			);
			return deleteUser;
		},
		onSuccess: (deleteUser) => {
			notifications.show({
				color: deleteUser ? "green" : "red",
				title: deleteUser ? "Success" : "Error",
				message: deleteUser
					? "User deleted successfully"
					: "User can not be deleted",
			});
			if (deleteUser) {
				revalidator.revalidate();
			}
		},
		onError: (error) => {
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to delete user",
			});
		},
	});

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
						variant="subtle"
						onClick={() => setUpdateUserData(user)}
					>
						<IconPencil />
					</ActionIcon>
					<ActionIcon
						color="red"
						variant="subtle"
						loading={deleteUserMutation.isPending}
						onClick={() => {
							openConfirmationModal(
								"Are you sure you want to delete this user?",
								() => deleteUserMutation.mutate(user.id),
							);
						}}
					>
						<IconTrash />
					</ActionIcon>
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
				action={withQuery(".", { intent: "update" })}
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
