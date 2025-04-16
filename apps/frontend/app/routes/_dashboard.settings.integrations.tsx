import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Alert,
	Anchor,
	Box,
	Button,
	Checkbox,
	Container,
	CopyButton,
	Drawer,
	Flex,
	Group,
	Modal,
	MultiSelect,
	NumberInput,
	Paper,
	Select,
	Stack,
	Table,
	type TableData,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	CreateOrUpdateUserIntegrationDocument,
	DeleteUserIntegrationDocument,
	GenerateAuthTokenDocument,
	IntegrationProvider,
	MediaSource,
	UserIntegrationsDocument,
	type UserIntegrationsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	getActionIntent,
	processSubmission,
	zodCheckboxAsString,
} from "@ryot/ts-utils";
import {
	IconCheck,
	IconCopy,
	IconEye,
	IconEyeClosed,
	IconPencil,
	IconTrash,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { Form, data, useActionData, useLoaderData } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import {
	PRO_REQUIRED_MESSAGE,
	applicationBaseUrl,
	dayjsLib,
	openConfirmationModal,
	zodCommaDelimitedString,
} from "~/lib/common";
import {
	useConfirmSubmit,
	useCoreDetails,
	useNonHiddenUserCollections,
} from "~/lib/hooks";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.integrations";

const PRO_INTEGRATIONS = [
	IntegrationProvider.JellyfinPush,
	IntegrationProvider.YoutubeMusic,
];
const YANK_INTEGRATIONS = [
	IntegrationProvider.Komga,
	IntegrationProvider.PlexYank,
	IntegrationProvider.YoutubeMusic,
	IntegrationProvider.Audiobookshelf,
];
const PUSH_INTEGRATIONS = [
	IntegrationProvider.Radarr,
	IntegrationProvider.Sonarr,
	IntegrationProvider.JellyfinPush,
];
const SYNC_TO_OWNED_COLLECTION_INTEGRATIONS = [
	IntegrationProvider.Komga,
	IntegrationProvider.PlexYank,
	IntegrationProvider.Audiobookshelf,
];
const NO_SHOW_URL = [...YANK_INTEGRATIONS, ...PUSH_INTEGRATIONS];
const NO_PROGRESS_ADJUSTMENT = [...PUSH_INTEGRATIONS];

export const loader = async ({ request }: Route.LoaderArgs) => {
	const [{ userIntegrations }] = await Promise.all([
		serverGqlService.authenticatedRequest(
			request,
			UserIntegrationsDocument,
			undefined,
		),
	]);
	return { userIntegrations };
};

export const meta = () => {
	return [{ title: "Integration Settings | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("delete", async () => {
			const submission = processSubmission(formData, deleteSchema);
			await serverGqlService.authenticatedRequest(
				request,
				DeleteUserIntegrationDocument,
				submission,
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
		})
		.with("createOrUpdate", async () => {
			const submission = processSubmission(formData, createOrUpdateSchema);
			// DEV: Reason for this: https://stackoverflow.com/a/11424089/11667450
			submission.isDisabled = submission.isDisabled === true;
			await serverGqlService.authenticatedRequest(
				request,
				CreateOrUpdateUserIntegrationDocument,
				{ input: submission },
			);

			const isUpdate = Boolean(submission.integrationId);
			return Response.json(
				{ status: "success", generateAuthToken: false } as const,
				{
					headers: await createToastHeaders({
						type: "success",
						message: `Integration ${isUpdate ? "updated" : "created"} successfully`,
					}),
				},
			);
		})
		.with("generateAuthToken", async () => {
			const { generateAuthToken } = await serverGqlService.authenticatedRequest(
				request,
				GenerateAuthTokenDocument,
				{},
			);
			return data({ status: "success", generateAuthToken } as const);
		})
		.run();
};

const MINIMUM_PROGRESS = "2";
const MAXIMUM_PROGRESS = "95";

const createOrUpdateSchema = z.object({
	name: z.string().optional(),
	integrationId: z.string().optional(),
	minimumProgress: z.string().optional(),
	maximumProgress: z.string().optional(),
	isDisabled: zodCheckboxAsString.optional(),
	syncToOwnedCollection: zodCheckboxAsString.optional(),
	provider: z.nativeEnum(IntegrationProvider).optional(),
	providerSpecifics: z
		.object({
			plexYankBaseUrl: z.string().optional(),
			plexYankToken: z.string().optional(),
			plexSinkUsername: z.string().optional(),
			audiobookshelfBaseUrl: z.string().optional(),
			audiobookshelfToken: z.string().optional(),
			komgaBaseUrl: z.string().optional(),
			komgaUsername: z.string().optional(),
			komgaPassword: z.string().optional(),
			komgaProvider: z.nativeEnum(MediaSource).optional(),
			radarrBaseUrl: z.string().optional(),
			radarrApiKey: z.string().optional(),
			radarrProfileId: z.number().optional(),
			radarrRootFolderPath: z.string().optional(),
			radarrSyncCollectionIds: zodCommaDelimitedString,
			sonarrBaseUrl: z.string().optional(),
			sonarrApiKey: z.string().optional(),
			sonarrProfileId: z.number().optional(),
			sonarrRootFolderPath: z.string().optional(),
			sonarrSyncCollectionIds: zodCommaDelimitedString,
			jellyfinPushBaseUrl: z.string().optional(),
			jellyfinPushUsername: z.string().optional(),
			jellyfinPushPassword: z.string().optional(),
			youtubeMusicTimezone: z.string().optional(),
			youtubeMusicAuthCookie: z.string().optional(),
		})
		.optional(),
});

const deleteSchema = z.object({
	integrationId: z.string(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const actionData = useActionData<typeof action>();
	const [createOrUpdateData, setCreateOrUpdateData] = useState<
		Integration | null | undefined
	>();

	return (
		<Container size="xs">
			<Stack>
				<Title>Integration settings</Title>
				{loaderData.userIntegrations.length > 0 ? (
					loaderData.userIntegrations.map((i, idx) => (
						<DisplayIntegration
							integration={i}
							key={`${i.id}-${idx}`}
							setCreateOrUpdateData={setCreateOrUpdateData}
						/>
					))
				) : (
					<Text>No integrations configured</Text>
				)}
				<Box w="100%">
					<Group justify="space-between">
						<Form
							replace
							method="POST"
							action={withQuery(".", { intent: "generateAuthToken" })}
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
							onClick={() => {
								setCreateOrUpdateData(null);
							}}
						>
							Add new integration
						</Button>
					</Group>
					<CreateOrUpdateModal
						integrationData={createOrUpdateData}
						close={() => setCreateOrUpdateData(undefined)}
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

const DisplayIntegration = (props: {
	integration: Integration;
	setCreateOrUpdateData: (data: Integration | null) => void;
}) => {
	const [parent] = useAutoAnimate();
	const [integrationUrlOpened, { toggle: integrationUrlToggle }] =
		useDisclosure(false);
	const [
		integrationTriggerResultOpened,
		{ toggle: integrationTriggerResultToggle },
	] = useDisclosure(false);
	const submit = useConfirmSubmit();

	const integrationUrl = `${applicationBaseUrl}/_i/${props.integration.id}`;

	const integrationDisplayName = [
		changeCase(props.integration.provider),
		props.integration.name,
	]
		.filter(Boolean)
		.join(" - ");

	const firstRow = [
		<Text size="sm" fw="bold" key="name">
			{integrationDisplayName}
		</Text>,
		props.integration.isDisabled ? (
			<Text size="sm" key="isPaused">
				Paused
			</Text>
		) : undefined,
		props.integration.triggerResult.length > 0 ? (
			<Anchor
				size="sm"
				key="triggerResult"
				onClick={() => integrationTriggerResultToggle()}
			>
				Show logs
			</Anchor>
		) : undefined,
	]
		.filter(Boolean)
		.map<ReactNode>((s) => s)
		.reduce((prev, curr) => [prev, " • ", curr]);

	const tableData: TableData = {
		head: ["Triggered At", "Error"],
		body: props.integration.triggerResult.map((tr) => [
			dayjsLib(tr.finishedAt).format("lll"),
			tr.error || "N/A",
		]),
	};

	return (
		<>
			<Drawer
				opened={integrationTriggerResultOpened}
				title={`Logs for ${integrationDisplayName}`}
				onClose={() => integrationTriggerResultToggle()}
			>
				<Table data={tableData} />
			</Drawer>
			<Paper p="xs" withBorder>
				<Stack ref={parent}>
					<Flex align="center" justify="space-between">
						<Box>
							<Group gap={4}>{firstRow}</Group>
							<Text size="xs">
								Created: {dayjsLib(props.integration.createdOn).fromNow()}
							</Text>
							{props.integration.lastFinishedAt ? (
								<Text size="xs">
									Last finished:{" "}
									{dayjsLib(props.integration.lastFinishedAt).fromNow()}
								</Text>
							) : null}
							{props.integration.syncToOwnedCollection ? (
								<Text size="xs">Being synced to "Owned" collection</Text>
							) : null}
						</Box>
						<Group>
							{!NO_SHOW_URL.includes(props.integration.provider) ? (
								<ActionIcon color="blue" onClick={integrationUrlToggle}>
									{integrationUrlOpened ? <IconEyeClosed /> : <IconEye />}
								</ActionIcon>
							) : null}
							<ActionIcon
								color="indigo"
								variant="subtle"
								onClick={() => {
									props.setCreateOrUpdateData(props.integration);
								}}
							>
								<IconPencil />
							</ActionIcon>
							<Form method="POST" action={withQuery(".", { intent: "delete" })}>
								<input
									type="hidden"
									name="integrationId"
									defaultValue={props.integration.id}
								/>
								<ActionIcon
									type="submit"
									color="red"
									variant="subtle"
									mt={4}
									onClick={(e) => {
										const form = e.currentTarget.form;
										e.preventDefault();
										openConfirmationModal(
											"Are you sure you want to delete this integration?",
											() => submit(form),
										);
									}}
								>
									<IconTrash />
								</ActionIcon>
							</Form>
						</Group>
					</Flex>
					{integrationUrlOpened ? (
						<TextInput
							value={integrationUrl}
							readOnly
							onClick={(e) => e.currentTarget.select()}
						/>
					) : null}
				</Stack>
			</Paper>
		</>
	);
};

const CreateOrUpdateModal = (props: {
	close: () => void;
	integrationData: Integration | null | undefined;
}) => {
	const coreDetails = useCoreDetails();
	const [provider, setProvider] = useState<IntegrationProvider | undefined>(
		props.integrationData?.provider,
	);

	const isUpdating = Boolean(props.integrationData?.id);
	const disableCreationButtonBecauseProRequired =
		!coreDetails.isServerKeyValidated &&
		provider &&
		PRO_INTEGRATIONS.includes(provider);

	return (
		<Modal
			centered
			onClose={props.close}
			withCloseButton={false}
			opened={props.integrationData !== undefined}
		>
			<Form
				replace
				method="POST"
				onSubmit={() => props.close()}
				action={withQuery(".", { intent: "createOrUpdate" })}
			>
				{isUpdating && props.integrationData && (
					<input
						type="hidden"
						name="integrationId"
						defaultValue={props.integrationData.id}
					/>
				)}
				<Stack>
					<Title order={3}>
						{isUpdating ? "Update" : "Create"} integration
					</Title>
					{!isUpdating ? (
						<Select
							required
							searchable
							name="provider"
							label="Select a provider"
							defaultValue={props.integrationData?.provider}
							onChange={(e) => setProvider(e as IntegrationProvider)}
							data={Object.values(IntegrationProvider).map((is) => ({
								value: is,
								label: changeCase(is),
							}))}
						/>
					) : null}
					<TextInput
						name="name"
						label="Name"
						defaultValue={props.integrationData?.name || undefined}
					/>
					{(!isUpdating &&
						provider &&
						!NO_PROGRESS_ADJUSTMENT.includes(provider)) ||
					(isUpdating &&
						props.integrationData &&
						!NO_PROGRESS_ADJUSTMENT.includes(
							props.integrationData.provider,
						)) ? (
						<Group wrap="nowrap">
							<NumberInput
								min={0}
								required={!isUpdating}
								max={100}
								size="xs"
								name="minimumProgress"
								label="Minimum progress"
								defaultValue={
									props.integrationData?.minimumProgress || MINIMUM_PROGRESS
								}
								description="Progress will not be synced below this value"
							/>
							<NumberInput
								min={0}
								required={!isUpdating}
								max={100}
								size="xs"
								name="maximumProgress"
								label="Maximum progress"
								defaultValue={
									props.integrationData?.maximumProgress || MAXIMUM_PROGRESS
								}
								description="After this value, progress will be marked as completed"
							/>
						</Group>
					) : null}
					{!isUpdating &&
						match(provider)
							.with(IntegrationProvider.Audiobookshelf, () => (
								<>
									<TextInput
										label="Base Url"
										required
										name="providerSpecifics.audiobookshelfBaseUrl"
									/>
									<TextInput
										label="Token"
										required
										name="providerSpecifics.audiobookshelfToken"
									/>
								</>
							))
							.with(IntegrationProvider.Komga, () => (
								<>
									<TextInput
										label="Base Url"
										required
										name="providerSpecifics.komgaBaseUrl"
									/>
									<TextInput
										label="Username"
										required
										name="providerSpecifics.komgaUsername"
									/>
									<TextInput
										label="Password"
										required
										name="providerSpecifics.komgaPassword"
									/>
									<Select
										label="Select a provider"
										name="providerSpecifics.komgaProvider"
										required
										data={[MediaSource.Anilist, MediaSource.Mal].map((is) => ({
											label: changeCase(is),
											value: is,
										}))}
									/>
								</>
							))
							.with(IntegrationProvider.PlexYank, () => (
								<>
									<TextInput
										required
										label="Base URL"
										name="providerSpecifics.plexYankBaseUrl"
									/>
									<TextInput
										required
										label="Plex token"
										name="providerSpecifics.plexYankToken"
									/>
								</>
							))
							.with(IntegrationProvider.YoutubeMusic, () => (
								<>
									<Select
										required
										searchable
										label="Timezone"
										name="providerSpecifics.youtubeMusicTimezone"
										data={Intl.supportedValuesOf("timeZone")}
										defaultValue={
											Intl.DateTimeFormat().resolvedOptions().timeZone
										}
									/>
									<TextInput
										required
										label="Auth Cookie"
										name="providerSpecifics.youtubeMusicAuthCookie"
										description={
											<Text size="xs" c="dimmed">
												Please follow the{" "}
												<Anchor
													target="_blank"
													rel="noreferrer noopener"
													href="https://docs.ryot.io/integrations#youtube-music"
												>
													docs
												</Anchor>{" "}
												to get the correct cookie
											</Text>
										}
									/>
								</>
							))
							.with(IntegrationProvider.PlexSink, () => (
								<>
									<TextInput
										label="Username"
										name="providerSpecifics.plexSinkUsername"
									/>
								</>
							))
							.with(IntegrationProvider.JellyfinPush, () => (
								<>
									<TextInput
										required
										label="Base URL"
										name="providerSpecifics.jellyfinPushBaseUrl"
									/>
									<TextInput
										required
										label="Username"
										name="providerSpecifics.jellyfinPushUsername"
									/>
									<TextInput
										required
										label="Password"
										name="providerSpecifics.jellyfinPushPassword"
									/>
								</>
							))
							.with(IntegrationProvider.Radarr, () => (
								<ArrInputs name="radarr" />
							))
							.with(IntegrationProvider.Sonarr, () => (
								<ArrInputs name="sonarr" />
							))
							.otherwise(() => undefined)}
					{(isUpdating &&
						props.integrationData &&
						SYNC_TO_OWNED_COLLECTION_INTEGRATIONS.includes(
							props.integrationData.provider,
						)) ||
					(!isUpdating &&
						provider &&
						SYNC_TO_OWNED_COLLECTION_INTEGRATIONS.includes(provider)) ? (
						<Tooltip
							label="Only available for Pro users"
							disabled={coreDetails.isServerKeyValidated}
						>
							<Checkbox
								name="syncToOwnedCollection"
								label="Sync to Owned collection"
								disabled={!coreDetails.isServerKeyValidated}
								styles={{ body: { display: "flex", alignItems: "center" } }}
								description={`Checking this will also sync items in your library to the "Owned" collection`}
								defaultChecked={
									props.integrationData?.syncToOwnedCollection || undefined
								}
							/>
						</Tooltip>
					) : undefined}
					{!isUpdating && (
						<Tooltip
							label={PRO_REQUIRED_MESSAGE}
							disabled={!disableCreationButtonBecauseProRequired}
						>
							<Button
								type="submit"
								disabled={disableCreationButtonBecauseProRequired}
							>
								Submit
							</Button>
						</Tooltip>
					)}
					{isUpdating && props.integrationData && (
						<>
							<Checkbox
								name="isDisabled"
								label="Pause integration"
								defaultChecked={props.integrationData.isDisabled || undefined}
							/>
							<Button type="submit">Update</Button>
						</>
					)}
				</Stack>
			</Form>
		</Modal>
	);
};

const ArrInputs = (props: { name: string }) => {
	const collections = useNonHiddenUserCollections();

	return (
		<>
			<TextInput
				required
				label="Base Url"
				name={`providerSpecifics.${props.name}BaseUrl`}
			/>
			<TextInput
				required
				label="Token"
				name={`providerSpecifics.${props.name}ApiKey`}
			/>
			<NumberInput
				required
				hideControls
				defaultValue={1}
				label="Profile ID"
				name={`providerSpecifics.${props.name}ProfileId`}
			/>
			<TextInput
				required
				label="Root Folder"
				name={`providerSpecifics.${props.name}RootFolderPath`}
			/>
			<MultiSelect
				required
				searchable
				label="Collections"
				name={`providerSpecifics.${props.name}SyncCollectionIds`}
				data={collections.map((c) => ({
					label: c.name,
					value: c.id,
				}))}
			/>
		</>
	);
};
