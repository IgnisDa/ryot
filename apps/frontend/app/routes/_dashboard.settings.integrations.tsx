import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Alert,
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
	Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import {
	Form,
	useActionData,
	useFetcher,
	useLoaderData,
} from "@remix-run/react";
import {
	CreateUserSinkIntegrationDocument,
	CreateUserYankIntegrationDocument,
	DeleteUserIntegrationDocument,
	GenerateAuthTokenDocument,
	UserIntegrationLot,
	UserIntegrationsDocument,
	UserIntegrationsQuery,
	UserSinkIntegrationSettingKind,
	UserYankIntegrationSettingKind,
} from "@ryot/generated/graphql/backend/graphql";
import { IconCheck, IconCopy, IconEye, IconTrash } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { dayjsLib } from "~/lib/generals";
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
			return json({ status: "success", generateAuthToken: false } as const, {
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
			return json({ status: "success", generateAuthToken: false } as const, {
				headers: await createToastHeaders({
					message: "Integration created successfully",
				}),
			});
		},
		generateAuthToken: async () => {
			const { generateAuthToken } = await gqlClient.request(
				GenerateAuthTokenDocument,
				undefined,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", generateAuthToken } as const);
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
	const actionData = useActionData<typeof action>();
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
						<DisplayIntegration integration={i} key={`${i.id}-${idx}`} />
					))
				) : (
					<Text>No integrations configured</Text>
				)}
				<Box w="100%">
					<Group justify="space-between">
						<Form method="post" action="?intent=generateAuthToken">
							<Button
								variant="light"
								color="orange"
								radius="md"
								type="submit"
								size="xs"
								fullWidth
							>
								Create API token
							</Button>
						</Form>
						<Button
							size="xs"
							variant="light"
							radius="md"
							onClick={openCreateUserYankIntegrationModal}
						>
							Add new integration
						</Button>
					</Group>
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
							) : null}
							{createUserSinkIntegrationLot ? (
								<input
									type="hidden"
									name="sinkLot"
									value={createUserSinkIntegrationLot}
								/>
							) : null}
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
								) : null}
								{createUserSinkIntegrationLot ===
								UserSinkIntegrationSettingKind.Plex ? (
									<>
										<TextInput label="Username" name="username" />
									</>
								) : null}
								<Button type="submit">Submit</Button>
							</Stack>
						</Box>
					</Modal>
				</Box>
				{actionData?.generateAuthToken ? (
					<Alert title="This token will be shown only once" color="yellow">
						<Flex align="center">
							<CopyButton value={actionData.generateAuthToken}>
								{({ copied, copy }) => (
									<Tooltip
										label={copied ? "Copied" : "Copy"}
										withArrow
										position="right"
									>
										<ActionIcon color={copied ? "teal" : "gray"} onClick={copy}>
											{copied ? (
												<IconCheck size={16} />
											) : (
												<IconCopy size={16} />
											)}
										</ActionIcon>
									</Tooltip>
								)}
							</CopyButton>
							<TextInput
								value={actionData.generateAuthToken}
								readOnly
								style={{ flex: 1 }}
								onClick={(e) => e.currentTarget.select()}
							/>
						</Flex>
					</Alert>
				) : null}
			</Stack>
		</Container>
	);
}

type Integration = UserIntegrationsQuery["userIntegrations"][number];

const DisplayIntegration = (props: { integration: Integration }) => {
	const [parent] = useAutoAnimate();
	const [integrationInputOpened, { toggle: integrationInputToggle }] =
		useDisclosure(false);
	const fetcher = useFetcher();
	const deleteFormRef = useRef<HTMLFormElement>(null);

	const integrationUrl =
		typeof window !== "undefined"
			? `${
					window.location.origin
			  }/backend/webhooks/integrations/${props.integration.description
					.toLowerCase()
					.split(" ")
					.at(0)}/${props.integration.slug}`
			: "";

	return (
		<Paper p="xs" withBorder>
			<Stack ref={parent}>
				<Flex align="center" justify="space-between">
					<Box>
						<Text size="xs">{props.integration.description}</Text>
						<Text size="xs">
							{dayjsLib(props.integration.timestamp).fromNow()}
						</Text>
					</Box>
					<Group>
						{props.integration.slug ? (
							<ActionIcon color="blue" onClick={integrationInputToggle}>
								<IconEye />
							</ActionIcon>
						) : null}
						<fetcher.Form
							action="?intent=delete"
							method="post"
							ref={deleteFormRef}
						>
							<input
								type="hidden"
								name="integrationLot"
								defaultValue={props.integration.lot}
							/>
							<input
								type="hidden"
								name="integrationId"
								defaultValue={props.integration.id}
							/>
							<ActionIcon
								color="red"
								variant="subtle"
								mt={4}
								onClick={async () => {
									const conf = await confirmWrapper({
										confirmation:
											"Are you sure you want to delete this integration?",
									});
									if (conf) fetcher.submit(deleteFormRef.current);
								}}
							>
								<IconTrash />
							</ActionIcon>
						</fetcher.Form>
					</Group>
				</Flex>
				{integrationInputOpened ? (
					<TextInput
						value={integrationUrl}
						readOnly
						onClick={(e) => e.currentTarget.select()}
					/>
				) : null}
			</Stack>
		</Paper>
	);
};
