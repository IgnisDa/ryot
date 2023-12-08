import {
	ActionIcon,
	Box,
	Button,
	Container,
	CopyButton,
	Flex,
	Group,
	Modal,
	Paper,
	Select,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	CreateUserSinkIntegrationDocument,
	CreateUserYankIntegrationDocument,
	DeleteUserIntegrationDocument,
	UserIntegrationLot,
	UserIntegrationsDocument,
	UserSinkIntegrationSettingKind,
	UserYankIntegrationSettingKind,
} from "@ryot/generated/graphql/backend/graphql";
import { IconCopy, IconTrash } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [{ userIntegrations }] = await Promise.all([
		gqlClient.request(
			UserIntegrationsDocument,
			undefined,
			await getAuthorizationHeader(request),
		),
	]);
	return json({ userIntegrations });
};

export const meta: MetaFunction = () => {
	return [{ title: "Integration Settings | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		delete: async () => {
			const submission = processSubmission(formData, deleteSchema);
			await gqlClient.request(
				DeleteUserIntegrationDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Integration deleted successfully",
				}),
			});
		},
		create: async () => {
			const submission = processSubmission(formData, createYankSchema);
			if (submission.yankLot) {
				await gqlClient.request(
					CreateUserYankIntegrationDocument,
					{
						input: {
							baseUrl: submission.baseUrl as string,
							token: submission.token as string,
							lot: submission.yankLot,
						},
					},
					await getAuthorizationHeader(request),
				);
			} else if (submission.sinkLot) {
				await gqlClient.request(
					CreateUserSinkIntegrationDocument,
					{
						input: {
							username: submission.username,
							lot: submission.sinkLot,
						},
					},
					await getAuthorizationHeader(request),
				);
			}
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Integration created successfully",
				}),
			});
		},
	});
};

const createYankSchema = z.object({
	baseUrl: z.string().url().optional(),
	token: z.string().optional(),
	username: z.string().optional(),
	yankLot: z.nativeEnum(UserYankIntegrationSettingKind).optional(),
	sinkLot: z.nativeEnum(UserSinkIntegrationSettingKind).optional(),
});

const deleteSchema = z.object({
	integrationId: zx.NumAsString,
	integrationLot: z.nativeEnum(UserIntegrationLot),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [
		createUserYankIntegrationModalOpened,
		{
			open: openCreateUserYankIntegrationModal,
			close: closeCreateUserYankIntegrationModal,
		},
	] = useDisclosure(false);
	const [createUserYankIntegrationLot, setCreateUserYankIntegrationLot] =
		useState<UserYankIntegrationSettingKind>();
	const [createUserSinkIntegrationLot, setCreateUserSinkIntegrationLot] =
		useState<UserSinkIntegrationSettingKind>();

	return (
		<Container size="xs">
			<Stack>
				<Title>Integration settings</Title>
				{loaderData.userIntegrations.length > 0 ? (
					loaderData.userIntegrations.map((i, idx) => (
						<Paper p="xs" withBorder key={`${i.id}-${idx}`}>
							<Flex align="center" justify="space-between">
								<Box>
									<Text size="xs">{i.description}</Text>
									<Text size="xs">
										{DateTime.fromISO(i.timestamp).toRelative()}
									</Text>
								</Box>
								<Group>
									{i.slug ? (
										<CopyButton
											value={
												typeof window !== "undefined"
													? `${
															window.location.origin
													  }/backend/webhooks/integrations/${i.description
															.toLowerCase()
															.split(" ")
															.at(0)}/${i.slug}`
													: ""
											}
										>
											{({ copy }) => (
												<ActionIcon
													color="green"
													onClick={() => {
														copy();
														notifications.show({
															color: "green",
															title: "Operation successful",
															message:
																"The integration url has been copied to your clipboard.",
														});
													}}
												>
													<IconCopy />
												</ActionIcon>
											)}
										</CopyButton>
									) : undefined}
									<Form action="?intent=delete" method="post">
										<input
											type="hidden"
											name="integrationLot"
											defaultValue={i.lot}
										/>
										<ActionIcon
											color="red"
											variant="subtle"
											size="sm"
											type="submit"
											name="integrationId"
											value={i.id}
											onClick={(e) => {
												if (
													!confirm(
														"Are you sure you want to delete this integration?",
													)
												)
													e.preventDefault();
											}}
										>
											<IconTrash />
										</ActionIcon>
									</Form>
								</Group>
							</Flex>
						</Paper>
					))
				) : (
					<Text>No integrations configured</Text>
				)}
				<Box ml="auto">
					<Button
						size="xs"
						variant="light"
						onClick={openCreateUserYankIntegrationModal}
					>
						Add new integration
					</Button>
					<Modal
						opened={createUserYankIntegrationModalOpened}
						onClose={closeCreateUserYankIntegrationModal}
						centered
						withCloseButton={false}
					>
						<Box
							component={Form}
							action="?intent=create"
							method="post"
							onSubmit={() => {
								closeCreateUserYankIntegrationModal();
								setCreateUserYankIntegrationLot(undefined);
								setCreateUserSinkIntegrationLot(undefined);
							}}
						>
							{createUserYankIntegrationLot ? (
								<input
									type="hidden"
									name="yankLot"
									value={createUserYankIntegrationLot}
								/>
							) : undefined}
							{createUserSinkIntegrationLot ? (
								<input
									type="hidden"
									name="sinkLot"
									value={createUserSinkIntegrationLot}
								/>
							) : undefined}
							<Stack>
								<Select
									label="Select a source"
									required
									data={[
										...Object.values(UserYankIntegrationSettingKind),
										...Object.values(UserSinkIntegrationSettingKind),
									]}
									// biome-ignore lint/suspicious/noExplicitAny: required here
									onChange={(v: any) => {
										if (v) {
											if (
												Object.values(UserYankIntegrationSettingKind).includes(
													v,
												)
											) {
												setCreateUserYankIntegrationLot(v);
												setCreateUserSinkIntegrationLot(undefined);
											}
											if (
												Object.values(UserSinkIntegrationSettingKind).includes(
													v,
												)
											) {
												setCreateUserSinkIntegrationLot(v);
												setCreateUserYankIntegrationLot(undefined);
											}
										}
									}}
								/>
								{createUserYankIntegrationLot ? (
									<>
										<TextInput label="Base Url" required name="baseUrl" />
										<TextInput label="Token" required name="token" />
									</>
								) : undefined}
								{createUserSinkIntegrationLot ===
								UserSinkIntegrationSettingKind.Plex ? (
									<>
										<TextInput label="Username" name="username" />
									</>
								) : undefined}
								<Button type="submit">Submit</Button>
							</Stack>
						</Box>
					</Modal>
				</Box>
			</Stack>
		</Container>
	);
}
