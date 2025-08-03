import {
	ActionIcon,
	Avatar,
	Box,
	Button,
	Container,
	CopyButton,
	Flex,
	Group,
	Modal,
	Paper,
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
	IconPencil,
	IconPlus,
	IconRotateClockwise,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { forwardRef, useState } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import { VirtuosoGrid } from "react-virtuoso";
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
};

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

const UrlDisplayModal = (
	props: {
		opened: boolean;
		onClose: () => void;
	} & UrlDisplayData,
) => {
	return (
		<Modal
			centered
			title={props.title}
			opened={props.opened}
			onClose={props.onClose}
		>
			<Stack>
				<TextInput
					readOnly
					value={props.url}
					label="URL"
					description={props.description}
					rightSection={
						<CopyButton value={props.url}>
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
	const coreDetails = useCoreDetails();
	const [
		registerUserModalOpened,
		{ open: openRegisterUserModal, close: closeRegisterUserModal },
	] = useDisclosure(false);
	const [username, setUsername] = useState("");
	const [urlDisplayData, setUrlDisplayData] = useState<UrlDisplayData | null>(
		null,
	);

	const handleCloseRegisterModal = () => {
		setUsername("");
		closeRegisterUserModal();
	};

	const handleCloseUrlDisplayModal = () => {
		setUrlDisplayData(null);
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
			setUrlDisplayData({
				title: "User Invitation Created",
				url: createUserInvitation.invitationUrl,
				description: "Share this URL with the user to set their password",
			});
			handleCloseRegisterModal();
		},
		onError: () => showErrorNotification("Failed to create user invitation"),
	});

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
				<Modal
					centered
					title="Create User Invitation"
					opened={registerUserModalOpened}
					onClose={handleCloseRegisterModal}
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
									<CopyButton
										value={createInvitationMutation.data.invitationUrl}
									>
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
				<DebouncedSearchInput
					placeholder="Search by name or ID"
					initialValue={loaderData.query.query}
					enhancedQueryParams={loaderData.cookieName}
				/>
				<VirtuosoGrid
					style={{ height: "70vh" }}
					totalCount={loaderData.usersList.length}
					itemContent={(index) => (
						<UserDisplay index={index} setUrlDisplayData={setUrlDisplayData} />
					)}
					components={{
						List: forwardRef((props, ref) => (
							<SimpleGrid ref={ref} {...props} cols={{ md: 2, xl: 3 }} />
						)),
					}}
				/>
				<UrlDisplayModal
					opened={urlDisplayData !== null}
					onClose={handleCloseUrlDisplayModal}
					title={urlDisplayData?.title || ""}
					url={urlDisplayData?.url || ""}
					description={urlDisplayData?.description || ""}
				/>
			</Stack>
		</Container>
	);
}

type User = UsersListQuery["usersList"][number];

const UserDisplay = (props: {
	index: number;
	setUrlDisplayData: (data: UrlDisplayData) => void;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const user = loaderData.usersList[props.index];
	const revalidator = useRevalidator();
	const coreDetails = useCoreDetails();
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

	if (!user) return null;

	return (
		<Paper p="xs" withBorder key={user.id} data-user-id={user.id}>
			<UpdateUserModal
				updateUserData={updateUserData}
				closeUpdateUserDataModal={() => setUpdateUserData(null)}
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
						color="orange"
						variant="subtle"
						loading={resetUserMutation.isPending}
						onClick={() => {
							openConfirmationModal(
								"Are you sure you want to reset this user? This action will permanently delete all user data including progress, collections, and preferences. This cannot be undone.",
								() => resetUserMutation.mutate(user.id),
							);
						}}
					>
						<IconRotateClockwise />
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
	closeUpdateUserDataModal: () => void;
}) => {
	const revalidator = useRevalidator();
	const [modalState, setModalState] = useState({
		adminToken: "",
		isDisabled: props.updateUserData?.isDisabled || false,
	});

	const updateIsDisabled = (isDisabled: boolean) => {
		setModalState((prev) => ({ ...prev, isDisabled }));
	};

	const updateAdminToken = (adminToken: string) => {
		setModalState((prev) => ({ ...prev, adminToken }));
	};

	const updateUserMutation = useMutation({
		mutationFn: async (input: {
			userId: string;
			adminAccessToken: string;
			isDisabled?: boolean;
			lot?: UserLot;
		}) => {
			const { updateUser } = await clientGqlService.request(
				UpdateUserDocument,
				{ input },
			);
			return updateUser;
		},
		onSuccess: () => {
			showSuccessNotification("User updated successfully");
			revalidator.revalidate();
			props.closeUpdateUserDataModal();
		},
		onError: () => showErrorNotification("Failed to update user"),
	});

	const handleClose = () => {
		props.closeUpdateUserDataModal();
	};

	const handleUpdate = () => {
		if (props.updateUserData?.id && modalState.adminToken) {
			updateUserMutation.mutate({
				userId: props.updateUserData.id,
				adminAccessToken: modalState.adminToken,
				isDisabled: modalState.isDisabled,
			});
		}
	};

	return (
		<Modal
			centered
			onClose={handleClose}
			withCloseButton={false}
			opened={props.updateUserData !== null}
		>
			<Stack>
				<Title order={3}>Update {props.updateUserData?.name}</Title>
				<TextInput
					required
					value={modalState.adminToken}
					onChange={(e) => updateAdminToken(e.currentTarget.value)}
					label="Admin Access Token"
					description="This is required as registration is disabled"
				/>
				<Switch
					label="Is disabled"
					checked={modalState.isDisabled}
					onChange={(e) => updateIsDisabled(e.currentTarget.checked)}
					description="This will disable the user from logging in"
				/>
				<Button
					fullWidth
					onClick={handleUpdate}
					loading={updateUserMutation.isPending}
					disabled={!modalState.adminToken}
				>
					Update
				</Button>
			</Stack>
		</Modal>
	);
};
