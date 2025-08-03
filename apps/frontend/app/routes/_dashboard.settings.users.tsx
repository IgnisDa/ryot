import {
	ActionIcon,
	Avatar,
	Badge,
	Button,
	Container,
	CopyButton,
	Flex,
	Group,
	Modal,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CreateUserInvitationDocument,
	DeleteUserDocument,
	ResetUserDocument,
	UpdateUserDocument,
	UserLot,
	UsersListDocument,
	type UsersListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, parseSearchQuery, truncate } from "@ryot/ts-utils";
import {
	IconCopy,
	IconPlus,
	IconRotateClockwise,
	IconTrash,
	IconUserOff,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { DataTable } from "mantine-datatable";
import { useState } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import { $path } from "safe-routes";
import { z } from "zod";
import { DebouncedSearchInput } from "~/components/common/filters";
import { useCoreDetails } from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/query-factory";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import {
	getSearchEnhancedCookieName,
	redirectIfNotAuthenticatedOrUpdated,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.users";

const searchParamsSchema = z.object({
	query: z.string().optional(),
});

const showSuccessNotification = (message: string) => {
	notifications.show({ message, color: "green", title: "Success" });
};

const showErrorNotification = (message: string) => {
	notifications.show({ message, color: "red", title: "Error" });
};

const createPasswordChangeUrl = (frontendUrl: string, sessionId: string) => {
	return `${frontendUrl}/change-password?sessionId=${sessionId}`;
};

export type SearchParams = z.infer<typeof searchParamsSchema>;

type UrlDisplayData = {
	url: string;
	title: string;
	description: string;
} | null;

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

const UserInvitationModal = (props: {
	opened: boolean;
	onClose: () => void;
	onSuccess: (data: UrlDisplayData) => void;
}) => {
	const coreDetails = useCoreDetails();
	const revalidator = useRevalidator();
	const [username, setUsername] = useState("");

	const handleClose = () => {
		setUsername("");
		props.onClose();
	};

	const handleCreateInvitation = () => {
		if (username.trim()) {
			createInvitationMutation.mutate(username.trim());
		}
	};

	const createInvitationMutation = useMutation({
		mutationFn: async (username: string) => {
			const { createUserInvitation } = await clientGqlService.request(
				CreateUserInvitationDocument,
				{ username },
			);
			const url = createPasswordChangeUrl(
				coreDetails.frontend.url,
				createUserInvitation.sessionId,
			);
			return { ...createUserInvitation, invitationUrl: url };
		},
		onSuccess: (createUserInvitation) => {
			showSuccessNotification("User invitation created successfully");
			revalidator.revalidate();
			props.onSuccess({
				title: "User Invitation Created",
				url: createUserInvitation.invitationUrl,
				description: "Share this URL with the user to set their password",
			});
			handleClose();
		},
		onError: () => showErrorNotification("Failed to create user invitation"),
	});

	return (
		<Modal
			centered
			opened={props.opened}
			onClose={handleClose}
			title="Create User Invitation"
		>
			<Stack>
				<TextInput
					required
					autoFocus
					value={username}
					label="Username"
					onChange={(e) => setUsername(e.currentTarget.value)}
				/>
				{createInvitationMutation.data?.invitationUrl && (
					<TextInput
						readOnly
						label="Invitation URL"
						value={createInvitationMutation.data.invitationUrl}
						description="Share this URL with the user to set their password"
						rightSection={
							<CopyButton value={createInvitationMutation.data.invitationUrl}>
								{({ copy }) => (
									<ActionIcon onClick={copy}>
										<IconCopy size={16} />
									</ActionIcon>
								)}
							</CopyButton>
						}
					/>
				)}
				{!createInvitationMutation.data?.invitationUrl && (
					<Button
						disabled={!username.trim()}
						onClick={handleCreateInvitation}
						loading={createInvitationMutation.isPending}
					>
						Create Invitation
					</Button>
				)}
			</Stack>
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
				<TextInput
					readOnly
					label="URL"
					value={props.data?.url}
					description={props.data?.description}
					rightSection={
						<CopyButton value={props.data?.url || ""}>
							{({ copy }) => (
								<ActionIcon onClick={copy}>
									<IconCopy size={16} />
								</ActionIcon>
							)}
						</CopyButton>
					}
				/>
				<Button onClick={props.onClose}>Close</Button>
			</Stack>
		</Modal>
	);
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [
		registerUserModalOpened,
		{ open: openRegisterUserModal, close: closeRegisterUserModal },
	] = useDisclosure(false);
	const [urlDisplayData, setUrlDisplayData] = useState<UrlDisplayData | null>(
		null,
	);

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
					placeholder="Search by name or ID"
					initialValue={loaderData.query.query}
					enhancedQueryParams={loaderData.cookieName}
				/>
				<DataTable
					height={600}
					borderRadius="sm"
					withColumnBorders
					withTableBorder={false}
					records={loaderData.usersList}
					columns={[
						{
							width: 250,
							accessor: "name",
							title: "User",
							render: ({ name }) => (
								<Group wrap="nowrap">
									<Avatar name={name} size="sm" />
									<Text fw="bold">{name}</Text>
								</Group>
							),
						},
						{
							width: 200,
							accessor: "id",
							title: "User ID",
							render: ({ id }) => (
								<Text size="sm" c="dimmed">
									{truncate(id, { length: 20 })}
								</Text>
							),
						},
						{
							width: 100,
							accessor: "lot",
							title: "Role",
							render: ({ lot }) => (
								<Badge size="sm" variant="light">
									{changeCase(lot)}
								</Badge>
							),
						},
						{
							width: 100,
							accessor: "isDisabled",
							title: "Status",
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
							width: 150,
							accessor: "actions",
							title: "Actions",
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
	const revalidator = useRevalidator();
	const coreDetails = useCoreDetails();

	const toggleUserStatusMutation = useMutation({
		mutationFn: async (input: {
			userId: string;
			isDisabled: boolean;
		}) => {
			const { updateUser } = await clientGqlService.request(
				UpdateUserDocument,
				{ input },
			);
			return updateUser;
		},
		onSuccess: () => {
			showSuccessNotification("User status updated successfully");
			revalidator.revalidate();
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
		onSuccess: (deleteUser) => {
			const message = deleteUser
				? "User deleted successfully"
				: "User can not be deleted";
			const color = deleteUser ? "green" : "red";
			notifications.show({
				color,
				message,
				title: deleteUser ? "Success" : "Error",
			});
			if (deleteUser) revalidator.revalidate();
		},
		onError: () => showErrorNotification("Failed to delete user"),
	});

	const resetUserMutation = useMutation({
		mutationFn: async (toResetUserId: string) => {
			const { resetUser } = await clientGqlService.request(ResetUserDocument, {
				toResetUserId,
			});
			return resetUser;
		},
		onSuccess: (resetUser) => {
			if (resetUser.__typename !== "UserResetResponse") return;
			if (resetUser.sessionId) {
				const url = createPasswordChangeUrl(
					coreDetails.frontend.url,
					resetUser.sessionId,
				);
				props.setUrlDisplayData({
					url,
					title: "Password Reset Link",
					description: "Share this URL with the user to reset their password",
				});
				showSuccessNotification("User reset successfully");
			} else {
				showSuccessNotification("User password reset successfully");
			}
		},
		onError: () => showErrorNotification("Failed to reset user"),
	});

	return (
		<>
			<Group justify="center">
				<ActionIcon
					variant="subtle"
					loading={toggleUserStatusMutation.isPending}
					color={props.user.isDisabled ? "green" : "yellow"}
					onClick={() => {
						const action = props.user.isDisabled ? "enable" : "disable";
						const newStatus = !props.user.isDisabled;
						openConfirmationModal(
							`Are you sure you want to ${action} this user? ${newStatus ? "The user will be unable to log in." : "The user will be able to log in again."}`,
							() =>
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
					color="orange"
					variant="subtle"
					loading={resetUserMutation.isPending}
					onClick={() => {
						openConfirmationModal(
							"Are you sure you want to reset this user? This action will permanently delete all user data including progress, collections, and preferences. This cannot be undone.",
							() => resetUserMutation.mutate(props.user.id),
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
		</>
	);
};
