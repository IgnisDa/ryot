import {
	ActionIcon,
	Avatar,
	Badge,
	Button,
	Container,
	Flex,
	Group,
	Modal,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	DeleteUserDocument,
	GetPasswordChangeSessionDocument,
	RegisterUserDocument,
	ResetUserDocument,
	UpdateUserDocument,
	type UpdateUserInput,
	UserLot,
	type UsersListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import {
	IconKey,
	IconPlus,
	IconRotateClockwise,
	IconTrash,
	IconUserOff,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { DataTable } from "mantine-datatable";
import { useState } from "react";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import { withQuery } from "ufo";
import { CopyableTextInput } from "~/components/common";
import { DebouncedSearchInput } from "~/components/common/filters";
import { redirectToQueryParam } from "~/lib/shared/constants";
import { useUserDetails, useUsersList } from "~/lib/shared/hooks";
import {
	clientGqlService,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";

export default function Page() {
	const [
		registerUserModalOpened,
		{ open: openRegisterUserModal, close: closeRegisterUserModal },
	] = useDisclosure(false);
	const [urlDisplayData, setUrlDisplayData] = useState<UrlDisplayData | null>(
		null,
	);
	const [query, setQuery] = useState("");

	const { data: usersList } = useUsersList(query);

	const handleCloseUrlDisplayModal = () => {
		setUrlDisplayData(null);
	};

	const handleInvitationSuccess = (data: UrlDisplayData) => {
		setUrlDisplayData(data);
	};

	return (
		<Container size="lg">
			<Stack>
				<Flex align="center" gap="md">
					<Title>Users settings</Title>
					<ActionIcon
						color="green"
						variant="outline"
						onClick={openRegisterUserModal}
					>
						<IconPlus size={20} />
					</ActionIcon>
				</Flex>
				<UserInvitationModal
					opened={registerUserModalOpened}
					onClose={closeRegisterUserModal}
					onSuccess={handleInvitationSuccess}
				/>
				<DebouncedSearchInput
					value={query}
					onChange={(q) => setQuery(q)}
					placeholder="Search by name or ID"
				/>
				<DataTable
					height={600}
					borderRadius="sm"
					withColumnBorders
					records={usersList}
					withTableBorder={false}
					columns={[
						{
							accessor: "id",
							title: "User ID",
							render: ({ id, name }) => (
								<Group wrap="nowrap">
									<Avatar name={name} size="sm" />

									<Text size="sm" c="dimmed">
										{id}
									</Text>
								</Group>
							),
						},
						{
							title: "Name",
							accessor: "name",
							render: ({ name }) => (
								<Text fw="bold" truncate>
									{name}
								</Text>
							),
						},
						{
							title: "Role",
							accessor: "lot",
							render: ({ lot }) => (
								<Badge
									size="sm"
									variant="light"
									color={lot === UserLot.Admin ? "red" : "blue"}
								>
									{changeCase(lot)}
								</Badge>
							),
						},
						{
							title: "Status",
							accessor: "isDisabled",
							render: ({ isDisabled }) => (
								<Badge
									size="sm"
									color={isDisabled ? "red" : "green"}
									variant="light"
								>
									{isDisabled ? "Disabled" : "Active"}
								</Badge>
							),
						},
						{
							width: 200,
							title: "Actions",
							accessor: "actions",
							textAlign: "center",
							render: (user) => (
								<UserActions
									user={user}
									setUrlDisplayData={setUrlDisplayData}
								/>
							),
						},
					]}
				/>
				<UrlDisplayModal
					data={urlDisplayData}
					opened={urlDisplayData !== null}
					onClose={handleCloseUrlDisplayModal}
				/>
			</Stack>
		</Container>
	);
}

type User = UsersListQuery["usersList"][number];

const UserActions = (props: {
	user: User;
	setUrlDisplayData: (data: UrlDisplayData) => void;
}) => {
	const userDetails = useUserDetails();
	const navigate = useNavigate();

	const toggleUserStatusMutation = useMutation({
		mutationFn: async (input: UpdateUserInput) => {
			const { updateUser } = await clientGqlService.request(
				UpdateUserDocument,
				{ input },
			);
			return { updateUser, input };
		},
		onSuccess: async ({ input }) => {
			invalidateUsersList();
			const isCurrentUser = input.userId === userDetails.id;
			showSuccessNotification("User status updated successfully");
			if (isCurrentUser && input.isDisabled) {
				handleCurrentUserLogout(navigate);
			}
		},
		onError: () => showErrorNotification("Failed to update user status"),
	});

	const deleteUserMutation = useMutation({
		mutationFn: async (toDeleteUserId: string) => {
			const { deleteUser } = await clientGqlService.request(
				DeleteUserDocument,
				{ toDeleteUserId },
			);
			return deleteUser;
		},
		onSuccess: async (deleteUser) => {
			invalidateUsersList();
			const message = deleteUser
				? "User deleted successfully"
				: "User cannot be deleted";
			const color = deleteUser ? "green" : "red";
			notifications.show({
				color,
				message,
				title: deleteUser ? "Success" : "Error",
			});
		},
		onError: () => showErrorNotification("Failed to delete user"),
	});

	const resetUserMutation = useMutation({
		onError: () => showErrorNotification("Failed to reset user"),
		mutationFn: async (toResetUserId: string) => {
			const { resetUser } = await clientGqlService.request(ResetUserDocument, {
				toResetUserId,
			});
			return resetUser;
		},
		onSuccess: async (resetUser) => {
			if (resetUser.__typename !== "UserResetResponse") return;
			invalidateUsersList();
			const isCurrentUser = props.user.id === userDetails.id;
			if (resetUser.passwordChangeUrl) {
				if (!isCurrentUser) {
					props.setUrlDisplayData({
						title: "Password Reset Link",
						url: resetUser.passwordChangeUrl,
						description: "Share this URL with the user to reset their password",
					});
				}
				showSuccessNotification("User reset successfully");
			} else {
				showSuccessNotification("User password reset successfully");
			}
			if (isCurrentUser && resetUser.passwordChangeUrl) {
				handleCurrentUserLogout(navigate, resetUser.passwordChangeUrl);
			}
		},
	});

	const getPasswordChangeSessionMutation = useMutation({
		onError: () =>
			showErrorNotification("Failed to get password change session"),
		mutationFn: async (userId: string) => {
			const { getPasswordChangeSession } = await clientGqlService.request(
				GetPasswordChangeSessionDocument,
				{ input: { userId } },
			);
			return getPasswordChangeSession.passwordChangeUrl;
		},
		onSuccess: async (passwordChangeUrl) => {
			props.setUrlDisplayData({
				url: passwordChangeUrl,
				title: "Password Change Link",
				description: "Share this URL with the user to change their password",
			});
			showSuccessNotification("Password change session created successfully");
		},
	});

	return (
		<Group justify="center">
			<ActionIcon
				variant="subtle"
				loading={toggleUserStatusMutation.isPending}
				color={props.user.isDisabled ? "green" : "yellow"}
				onClick={() => {
					const action = props.user.isDisabled ? "enable" : "disable";
					const newStatus = !props.user.isDisabled;
					const isCurrentUser = props.user.id === userDetails.id;
					const confirmationMessage =
						isCurrentUser && newStatus
							? `Are you sure you want to ${action} your own account? You will be logged out immediately and unable to log in until an admin re-enables your account.`
							: `Are you sure you want to ${action} this user? ${newStatus ? "The user will be unable to log in." : "The user will be able to log in again."}`;

					openConfirmationModal(confirmationMessage, () =>
						toggleUserStatusMutation.mutate({
							userId: props.user.id,
							isDisabled: newStatus,
						}),
					);
				}}
			>
				<IconUserOff size={18} />
			</ActionIcon>
			<ActionIcon
				color="cyan"
				variant="subtle"
				loading={getPasswordChangeSessionMutation.isPending}
				onClick={() => {
					openConfirmationModal(
						"Are you sure you want to generate a password change session for this user? This will create a one-time link that allows them to change their password.",
						() => getPasswordChangeSessionMutation.mutate(props.user.id),
					);
				}}
			>
				<IconKey size={18} />
			</ActionIcon>
			<ActionIcon
				color="orange"
				variant="subtle"
				loading={resetUserMutation.isPending}
				onClick={() => {
					const isCurrentUser = props.user.id === userDetails.id;
					const confirmationMessage = isCurrentUser
						? "Are you sure you want to reset your own account? This action will permanently delete all your data including progress, collections, and preferences. You will be logged out and redirected to set a new password."
						: "Are you sure you want to reset this user? This action will permanently delete all user data including progress, collections, and preferences. This cannot be undone.";

					openConfirmationModal(confirmationMessage, () =>
						resetUserMutation.mutate(props.user.id),
					);
				}}
			>
				<IconRotateClockwise size={18} />
			</ActionIcon>
			<ActionIcon
				color="red"
				variant="subtle"
				loading={deleteUserMutation.isPending}
				onClick={() => {
					openConfirmationModal(
						"Are you sure you want to delete this user?",
						() => deleteUserMutation.mutate(props.user.id),
					);
				}}
			>
				<IconTrash size={18} />
			</ActionIcon>
		</Group>
	);
};

const showSuccessNotification = (message: string) => {
	notifications.show({ message, color: "green", title: "Success" });
};

const showErrorNotification = (message: string) => {
	notifications.show({ message, color: "red", title: "Error" });
};

const handleCurrentUserLogout = (
	navigate: ReturnType<typeof useNavigate>,
	passwordChangeUrl?: string,
) => {
	const changePasswordUrl = passwordChangeUrl || $path("/auth");
	const logoutRoute = withQuery($path("/api/logout"), {
		[redirectToQueryParam]: changePasswordUrl,
	});
	navigate(logoutRoute);
};

type UrlDisplayData = {
	url: string;
	title: string;
	description: string;
} | null;

export const meta = () => {
	return [{ title: "User Settings | Ryot" }];
};

const invalidateUsersList = () =>
	queryClient.invalidateQueries({
		queryKey: queryFactory.miscellaneous.usersList._def,
	});

const UserInvitationModal = (props: {
	opened: boolean;
	onClose: () => void;
	onSuccess: (data: UrlDisplayData) => void;
}) => {
	const form = useForm({
		mode: "uncontrolled",
		initialValues: { username: "" },
		validate: { username: hasLength({ min: 1 }, "Username is required") },
	});

	const handleClose = () => {
		form.reset();
		props.onClose();
	};

	const createInvitationMutation = useMutation({
		mutationFn: async (username: string) => {
			const { registerUser } = await clientGqlService.request(
				RegisterUserDocument,
				{ input: { data: { password: { username, password: "" } } } },
			);

			if (registerUser.__typename !== "StringIdObject")
				throw new Error("Failed to register user");

			const { getPasswordChangeSession } = await clientGqlService.request(
				GetPasswordChangeSessionDocument,
				{ input: { userId: registerUser.id } },
			);

			return getPasswordChangeSession.passwordChangeUrl;
		},
		onError: () => showErrorNotification("Failed to create user invitation"),
		onSuccess: async (createUserInvitation) => {
			showSuccessNotification("User invitation created successfully");
			props.onSuccess({
				url: createUserInvitation,
				title: "User Invitation Created",
				description: "Share this URL with the user to set their password",
			});
			invalidateUsersList();
			handleClose();
			createInvitationMutation.reset();
		},
	});

	return (
		<Modal
			centered
			opened={props.opened}
			onClose={handleClose}
			title="Create User Invitation"
		>
			<form
				onSubmit={form.onSubmit((values) => {
					createInvitationMutation.mutate(values.username.trim());
				})}
			>
				<Stack>
					<TextInput
						required
						data-autofocus
						label="Username"
						{...form.getInputProps("username")}
					/>
					{!createInvitationMutation.data && (
						<Button type="submit" loading={createInvitationMutation.isPending}>
							Create Invitation
						</Button>
					)}
				</Stack>
			</form>
		</Modal>
	);
};

const UrlDisplayModal = (props: {
	opened: boolean;
	onClose: () => void;
	data: UrlDisplayData;
}) => {
	return (
		<Modal
			centered
			opened={props.opened}
			onClose={props.onClose}
			title={props.data?.title}
		>
			<Stack>
				<CopyableTextInput
					value={props.data?.url}
					description={props.data?.description}
				/>
				<Button onClick={props.onClose}>Close</Button>
			</Stack>
		</Modal>
	);
};
