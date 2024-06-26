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
	NumberInput,
	Paper,
	Select,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import {
	Form,
	useActionData,
	useFetcher,
	useLoaderData,
} from "@remix-run/react";
import {
	CreateUserIntegrationDocument,
	DeleteUserIntegrationDocument,
	GenerateAuthTokenDocument,
	IntegrationSource,
	UserIntegrationsDocument,
	type UserIntegrationsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import {
	IconCheck,
	IconCopy,
	IconEye,
	IconEyeClosed,
	IconTrash,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { confirmWrapper } from "~/components/confirmation";
import { dayjsLib } from "~/lib/generals";
import {
	createToastHeaders,
	getAuthorizationHeader,
	processSubmission,
	serverGqlService,
} from "~/lib/utilities.server";

const YANK_INTEGRATIONS = [IntegrationSource.Audiobookshelf];

export const loader = unstable_defineLoader(async ({ request }) => {
	const [{ userIntegrations }] = await Promise.all([
		serverGqlService.request(
			UserIntegrationsDocument,
			undefined,
			getAuthorizationHeader(request),
		),
	]);
	return { userIntegrations };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Integration Settings | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		delete: async () => {
			const submission = processSubmission(formData, deleteSchema);
			await serverGqlService.request(
				DeleteUserIntegrationDocument,
				submission,
				getAuthorizationHeader(request),
			);
			return Response.json(
				{ status: "success", generateAuthToken: false } as const,
				{
					headers: await createToastHeaders({
						type: "success",
						message: "Integration deleted successfully",
					}),
				},
			);
		},
		create: async () => {
			const submission = processSubmission(formData, createSchema);
			await serverGqlService.request(
				CreateUserIntegrationDocument,
				{ input: submission },
				getAuthorizationHeader(request),
			);
			return Response.json(
				{ status: "success", generateAuthToken: false } as const,
				{
					headers: await createToastHeaders({
						type: "success",
						message: "Integration created successfully",
					}),
				},
			);
		},
		generateAuthToken: async () => {
			const { generateAuthToken } = await serverGqlService.request(
				GenerateAuthTokenDocument,
				undefined,
				getAuthorizationHeader(request),
			);
			return Response.json({ status: "success", generateAuthToken } as const);
		},
	});
});

const MINIMUM_PROGRESS = "2";
const MAXIMUM_PROGRESS = "95";

const createSchema = z.object({
	source: z.nativeEnum(IntegrationSource),
	minimumProgress: z.string().default(MINIMUM_PROGRESS),
	maximumProgress: z.string().default(MAXIMUM_PROGRESS),
	sourceSpecifics: z
		.object({
			plexUsername: z.string().optional(),
			audiobookshelfBaseUrl: z.string().optional(),
			audiobookshelfToken: z.string().optional(),
		})
		.optional(),
});

const deleteSchema = z.object({
	integrationId: z.string(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const actionData = useActionData<typeof action>();
	const [
		createIntegrationModalOpened,
		{
			open: openCreateUserYankIntegrationModal,
			close: closeCreateIntegrationModal,
		},
	] = useDisclosure(false);

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
						<Form
							replace
							method="POST"
							action={withQuery("", { intent: "generateAuthToken" })}
						>
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
					<CreateIntegrationModal
						createModalOpened={createIntegrationModalOpened}
						closeIntegrationModal={closeCreateIntegrationModal}
					/>
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
	const fetcher = useFetcher<typeof action>();
	const deleteFormRef = useRef<HTMLFormElement>(null);

	const integrationUrl =
		typeof window !== "undefined"
			? `${window.location.origin}/_i/${props.integration.id}`
			: "";

	return (
		<Paper p="xs" withBorder>
			<Stack ref={parent}>
				<Flex align="center" justify="space-between">
					<Box>
						<Text size="sm" fw="bold">
							{changeCase(props.integration.source)}
						</Text>
						<Text size="xs">
							Created: {dayjsLib(props.integration.createdOn).fromNow()}
						</Text>
						{props.integration.lastTriggeredOn ? (
							<Text size="xs">
								Triggered:{" "}
								{dayjsLib(props.integration.lastTriggeredOn).fromNow()}
							</Text>
						) : null}
					</Box>
					<Group>
						{!YANK_INTEGRATIONS.includes(props.integration.source) ? (
							<ActionIcon color="blue" onClick={integrationInputToggle}>
								{integrationInputOpened ? <IconEyeClosed /> : <IconEye />}
							</ActionIcon>
						) : null}
						<fetcher.Form
							method="POST"
							ref={deleteFormRef}
							action={withQuery("", { intent: "delete" })}
						>
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

const CreateIntegrationModal = (props: {
	createModalOpened: boolean;
	closeIntegrationModal: () => void;
}) => {
	const [source, setSource] = useState<IntegrationSource | null>(null);

	return (
		<Modal
			opened={props.createModalOpened}
			onClose={props.closeIntegrationModal}
			centered
			withCloseButton={false}
		>
			<Form
				replace
				method="POST"
				onSubmit={() => props.closeIntegrationModal()}
				action={withQuery("", { intent: "create" })}
			>
				<Stack>
					<Select
						label="Select a source"
						name="source"
						required
						data={Object.values(IntegrationSource).map((is) => ({
							label: changeCase(is),
							value: is,
						}))}
						onChange={(e) => setSource(e as IntegrationSource)}
					/>
					{source ? (
						<Group wrap="nowrap">
							<NumberInput
								size="xs"
								label="Minimum progress"
								description="Progress will not be synced below this value"
								required
								name="minimumProgress"
								defaultValue={MINIMUM_PROGRESS}
								min={0}
								max={100}
							/>
							<NumberInput
								size="xs"
								label="Maximum progress"
								description="After this value, progress will be marked as completed"
								required
								name="maximumProgress"
								defaultValue={MAXIMUM_PROGRESS}
								min={0}
								max={100}
							/>
						</Group>
					) : null}
					{match(source)
						.with(IntegrationSource.Audiobookshelf, () => (
							<>
								<TextInput
									label="Base Url"
									required
									name="sourceSpecifics.audiobookshelfBaseUrl"
								/>
								<TextInput
									label="Token"
									required
									name="sourceSpecifics.audiobookshelfToken"
								/>
							</>
						))
						.with(IntegrationSource.Plex, () => (
							<>
								<TextInput
									label="Username"
									name="sourceSpecifics.plexUsername"
								/>
							</>
						))
						.otherwise(() => undefined)}
					<Button type="submit">Submit</Button>
				</Stack>
			</Form>
		</Modal>
	);
};
