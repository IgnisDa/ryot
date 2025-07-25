import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Alert,
	Anchor,
	Box,
	Button,
	Checkbox,
	Collapse,
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
	Textarea,
	Title,
	Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
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
	kebabCase,
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
} from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useConfirmSubmit,
	useCoreDetails,
	useDashboardLayoutData,
	useNonHiddenUserCollections,
} from "~/lib/shared/hooks";
import {
	convertEnumToSelectData,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import { zodCommaDelimitedString } from "~/lib/shared/validation";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.integrations";

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
	return [{ title: "Integrations Settings | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
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
			return data({ status: "success", generateAuthToken: false } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: `Integration ${isUpdate ? "updated" : "created"} successfully`,
				}),
			});
		})
		.with("delete", async () => {
			const submission = processSubmission(formData, deleteSchema);
			await serverGqlService.authenticatedRequest(
				request,
				DeleteUserIntegrationDocument,
				submission,
			);
			return data({ status: "success", generateAuthToken: false } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Integration deleted successfully",
				}),
			});
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

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const actionData = useActionData<typeof action>();
	const [createOrUpdateData, setCreateOrUpdateData] = useState<
		Integration | null | undefined
	>();

	return (
		<Container size="xs">
			<Stack>
				<Title>Integrations settings</Title>
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
						key={createOrUpdateData?.id}
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
	const { isAccessLinkSession } = useDashboardLayoutData();
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
			<Text size="xs" key="isPaused">
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
							{shouldShowUrl(props.integration.provider) ? (
								<ActionIcon color="blue" onClick={integrationUrlToggle}>
									{integrationUrlOpened ? <IconEyeClosed /> : <IconEye />}
								</ActionIcon>
							) : null}
							<ActionIcon
								color="indigo"
								variant="subtle"
								onClick={() => {
									if (isAccessLinkSession) {
										notifications.show({
											color: "red",
											message:
												"You do not have permission to edit integrations",
										});
										return;
									}
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
									mt={4}
									color="red"
									type="submit"
									variant="subtle"
									onClick={(e) => {
										const form = e.currentTarget.form;
										e.preventDefault();
										if (isAccessLinkSession) {
											notifications.show({
												color: "red",
												message:
													"You do not have permission to delete integrations",
											});
											return;
										}
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

type FieldType =
	| "text"
	| "number"
	| "select"
	| "password"
	| "textarea"
	| "multiselect";

interface FieldConfig {
	name: string;
	label: string;
	rows?: number;
	type: FieldType;
	notRequired?: true;
	description?: string;
	placeholder?: string;
	options?: { value: string; label: string }[];
	transform?: (value: string | undefined) => unknown;
}

interface ProviderConfig {
	fields?: FieldConfig[];
	capabilities: {
		isPro?: true;
		isYank?: true;
		isPush?: true;
		showUrl?: true;
		progressAdjustment?: true;
		syncToOwnedCollection?: true;
	};
}

const tagIdsTransform = (val: string | undefined) =>
	val
		? val
				.split(",")
				.map((id) => Number.parseInt(id.trim()))
				.filter((id) => !Number.isNaN(id))
		: undefined;

const disabledSitesTransform = (val: string | undefined) =>
	val ? val.split("\n").filter((line) => line.trim() !== "") : undefined;

const PROVIDER_CONFIGS: Record<IntegrationProvider, ProviderConfig> = {
	[IntegrationProvider.Audiobookshelf]: {
		capabilities: {
			isYank: true,
			progressAdjustment: true,
			syncToOwnedCollection: true,
		},
		fields: [
			{
				type: "text",
				label: "Base Url",
				name: "audiobookshelfBaseUrl",
			},
			{
				type: "text",
				label: "Token",
				name: "audiobookshelfToken",
			},
		],
	},
	[IntegrationProvider.Komga]: {
		capabilities: {
			isYank: true,
			progressAdjustment: true,
			syncToOwnedCollection: true,
		},
		fields: [
			{ name: "komgaBaseUrl", label: "Base Url", type: "text" },
			{
				type: "text",
				label: "Username",
				name: "komgaUsername",
			},
			{
				type: "password",
				label: "Password",
				name: "komgaPassword",
			},
			{
				type: "select",
				label: "Provider",
				name: "komgaProvider",
				options: [MediaSource.Anilist, MediaSource.Myanimelist].map(
					(source) => ({
						value: source,
						label: changeCase(source),
					}),
				),
			},
		],
	},
	[IntegrationProvider.PlexYank]: {
		capabilities: {
			isYank: true,
			progressAdjustment: true,
			syncToOwnedCollection: true,
		},
		fields: [
			{
				type: "text",
				label: "Base URL",
				name: "plexYankBaseUrl",
			},
			{
				type: "text",
				label: "Plex token",
				name: "plexYankToken",
			},
		],
	},
	[IntegrationProvider.YoutubeMusic]: {
		capabilities: {
			isPro: true,
			isYank: true,
			progressAdjustment: true,
		},
		fields: [
			{
				type: "select",
				label: "Timezone",
				name: "youtubeMusicTimezone",
				options: Intl.supportedValuesOf("timeZone").map((tz) => ({
					value: tz,
					label: tz,
				})),
			},
			{
				type: "text",
				label: "Auth Cookie",
				name: "youtubeMusicAuthCookie",
				description: "Follow the link above to obtain the correct cookie",
			},
		],
	},
	[IntegrationProvider.PlexSink]: {
		capabilities: { showUrl: true, progressAdjustment: true },
		fields: [
			{
				type: "text",
				notRequired: true,
				label: "Username",
				name: "plexSinkUsername",
			},
		],
	},
	[IntegrationProvider.JellyfinPush]: {
		capabilities: { isPro: true, isPush: true },
		fields: [
			{
				type: "text",
				label: "Base URL",
				name: "jellyfinPushBaseUrl",
			},
			{
				type: "text",
				label: "Username",
				name: "jellyfinPushUsername",
			},
			{
				type: "password",
				label: "Password",
				notRequired: true,
				name: "jellyfinPushPassword",
			},
		],
	},
	[IntegrationProvider.Radarr]: {
		capabilities: { isPush: true },
		fields: [
			{
				type: "text",
				label: "Base Url",
				name: "radarrBaseUrl",
			},
			{ name: "radarrApiKey", label: "Token", type: "text" },
			{
				type: "number",
				label: "Profile ID",
				name: "radarrProfileId",
			},
			{
				type: "text",
				label: "Root Folder",
				name: "radarrRootFolderPath",
			},
			{
				type: "multiselect",
				label: "Collections",
				name: "radarrSyncCollectionIds",
			},
			{
				type: "text",
				label: "Tag IDs",
				notRequired: true,
				placeholder: "1,2,3",
				name: "radarrTagIds",
				transform: tagIdsTransform,
				description: "Comma separated list of tag IDs to apply to new items",
			},
		],
	},
	[IntegrationProvider.Sonarr]: {
		capabilities: { isPush: true },
		fields: [
			{
				type: "text",
				label: "Base Url",
				name: "sonarrBaseUrl",
			},
			{ name: "sonarrApiKey", label: "Token", type: "text" },
			{
				type: "number",
				label: "Profile ID",
				name: "sonarrProfileId",
			},
			{
				type: "text",
				label: "Root Folder",
				name: "sonarrRootFolderPath",
			},
			{
				type: "multiselect",
				label: "Collections",
				name: "sonarrSyncCollectionIds",
			},
			{
				type: "text",
				label: "Tag IDs",
				notRequired: true,
				placeholder: "1,2,3",
				name: "sonarrTagIds",
				transform: tagIdsTransform,
				description: "Comma separated list of tag IDs to apply to new items",
			},
		],
	},
	[IntegrationProvider.RyotBrowserExtension]: {
		capabilities: { isPro: true, showUrl: true, progressAdjustment: true },
		fields: [
			{
				rows: 4,
				type: "textarea",
				notRequired: true,
				label: "Disabled Sites",
				transform: disabledSitesTransform,
				placeholder: "netflix.com\nhbo.com",
				name: "ryotBrowserExtensionDisabledSites",
				description:
					"Extension is enabled on all sites by default. Enter one domain per line where extension should be disabled",
			},
		],
	},
	[IntegrationProvider.Emby]: {
		capabilities: { showUrl: true, progressAdjustment: true },
	},
	[IntegrationProvider.GenericJson]: {
		capabilities: { showUrl: true, progressAdjustment: true },
	},
	[IntegrationProvider.JellyfinSink]: {
		capabilities: { showUrl: true, progressAdjustment: true },
	},
	[IntegrationProvider.Kodi]: {
		capabilities: { showUrl: true, progressAdjustment: true },
	},
};

const MINIMUM_PROGRESS = "2";
const MAXIMUM_PROGRESS = "95";

const createProviderSpecificsSchema = () => {
	const schemas: Record<string, z.ZodTypeAny> = {};

	for (const config of Object.values(PROVIDER_CONFIGS)) {
		if (!config.fields) continue;
		for (const field of config.fields) {
			let fieldSchema: z.ZodTypeAny;

			switch (field.type) {
				case "text":
				case "password":
				case "textarea":
				case "select":
					fieldSchema = field.transform
						? field.notRequired
							? z.string().optional().transform(field.transform)
							: z.string().transform(field.transform)
						: field.notRequired
							? z.string().optional()
							: z.string();
					break;
				case "number":
					fieldSchema = field.notRequired ? z.number().optional() : z.number();
					break;
				case "multiselect":
					fieldSchema = field.notRequired
						? zodCommaDelimitedString.optional()
						: zodCommaDelimitedString;
					break;
				default:
					fieldSchema = field.notRequired
						? z.unknown().optional()
						: z.unknown();
			}

			schemas[field.name] = fieldSchema;
		}
	}

	return z.object(schemas).optional();
};

const createOrUpdateSchema = z.object({
	name: z.string().optional(),
	integrationId: z.string().optional(),
	minimumProgress: z.string().optional(),
	maximumProgress: z.string().optional(),
	isDisabled: zodCheckboxAsString.optional(),
	providerSpecifics: createProviderSpecificsSchema(),
	syncToOwnedCollection: zodCheckboxAsString.optional(),
	provider: z.enum(IntegrationProvider).optional(),
	extraSettings: z.object({
		disableOnContinuousErrors: zodCheckboxAsString,
	}),
});

const deleteSchema = z.object({
	integrationId: z.string(),
});

const getProviderCapabilities = (provider: IntegrationProvider) =>
	PROVIDER_CONFIGS[provider]?.capabilities || {};

const isProProvider = (provider: IntegrationProvider) =>
	!!getProviderCapabilities(provider).isPro;

const supportsSyncToOwnedCollection = (provider: IntegrationProvider) =>
	!!getProviderCapabilities(provider).syncToOwnedCollection;

const shouldShowUrl = (provider: IntegrationProvider) =>
	!!getProviderCapabilities(provider).showUrl;

const supportsProgressAdjustment = (provider: IntegrationProvider) =>
	!!getProviderCapabilities(provider).progressAdjustment;

const ProviderField = (props: {
	field: FieldConfig;
	defaultValue?: unknown;
}) => {
	const collections = useNonHiddenUserCollections();

	const fieldName = `providerSpecifics.${props.field.name}`;
	const value = props.defaultValue;

	switch (props.field.type) {
		case "text":
		case "password":
			return (
				<TextInput
					name={fieldName}
					type={props.field.type}
					label={props.field.label}
					required={!props.field.notRequired}
					description={props.field.description}
					placeholder={props.field.placeholder}
					defaultValue={(value as string) || undefined}
				/>
			);
		case "number":
			return (
				<NumberInput
					name={fieldName}
					label={props.field.label}
					required={!props.field.notRequired}
					description={props.field.description}
					defaultValue={(value as number) || undefined}
					hideControls={props.field.name.includes("ProfileId")}
				/>
			);
		case "select":
			return (
				<Select
					name={fieldName}
					label={props.field.label}
					data={props.field.options}
					required={!props.field.notRequired}
					description={props.field.description}
					searchable={props.field.name === "youtubeMusicTimezone"}
					defaultValue={
						props.field.name === "youtubeMusicTimezone" && !value
							? Intl.DateTimeFormat().resolvedOptions().timeZone
							: (value as string) || undefined
					}
				/>
			);
		case "multiselect":
			return (
				<MultiSelect
					searchable
					name={fieldName}
					label={props.field.label}
					required={!props.field.notRequired}
					description={props.field.description}
					defaultValue={(value as string[]) || undefined}
					data={collections.map((c) => ({
						label: c.name,
						value: c.id,
					}))}
				/>
			);
		case "textarea":
			return (
				<Textarea
					name={fieldName}
					label={props.field.label}
					rows={props.field.rows || 4}
					required={!props.field.notRequired}
					description={props.field.description}
					placeholder={props.field.placeholder}
					defaultValue={
						Array.isArray(value)
							? (value as string[]).join("\n")
							: (value as string) || undefined
					}
				/>
			);
		default:
			return null;
	}
};

const ProviderFields = (props: {
	provider: IntegrationProvider;
	integrationData?: Integration | null;
}) => {
	const config = PROVIDER_CONFIGS[props.provider];
	if (!config) return null;

	return config.fields?.map((field) => (
		<ProviderField
			key={field.name}
			field={field}
			defaultValue={
				props.integrationData?.providerSpecifics?.[
					field.name as keyof typeof props.integrationData.providerSpecifics
				]
			}
		/>
	));
};

const CreateOrUpdateModal = (props: {
	close: () => void;
	integrationData: Integration | null | undefined;
}) => {
	const coreDetails = useCoreDetails();
	const [provider, setProvider] = useState<IntegrationProvider | undefined>(
		props.integrationData?.provider,
	);
	const [isAdvancedSettingsOpened, { toggle: toggleAdvancedSettings }] =
		useDisclosure(false);

	const isUpdating = Boolean(props.integrationData?.id);
	const disableCreationButtonBecauseProRequired =
		!coreDetails.isServerKeyValidated && provider && isProProvider(provider);

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
				{props.integrationData && (
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
							data={convertEnumToSelectData(IntegrationProvider)}
							onChange={(e) => setProvider(e as IntegrationProvider)}
						/>
					) : null}
					{provider ? (
						<Anchor
							size="xs"
							target="_blank"
							href={`${coreDetails.docsLink}/integrations/${kebabCase(provider)}.html`}
						>
							Click here to see the documentation for this source
						</Anchor>
					) : null}
					{provider && (
						<ProviderFields
							provider={provider}
							integrationData={props.integrationData}
						/>
					)}
					{provider && (
						<Group justify="end">
							<Button
								size="compact-xs"
								variant="subtle"
								onClick={toggleAdvancedSettings}
							>
								{isAdvancedSettingsOpened ? "Hide" : "Show"} advanced settings
							</Button>
						</Group>
					)}
					<Collapse in={isAdvancedSettingsOpened}>
						<Stack>
							<TextInput
								name="name"
								label="Name"
								defaultValue={props.integrationData?.name || undefined}
							/>
							{provider && supportsProgressAdjustment(provider) ? (
								<Group wrap="nowrap">
									<NumberInput
										min={0}
										size="xs"
										max={100}
										required
										name="minimumProgress"
										label="Minimum progress"
										description="Progress will not be synced below this value"
										defaultValue={
											props.integrationData?.minimumProgress || MINIMUM_PROGRESS
										}
									/>
									<NumberInput
										min={0}
										size="xs"
										max={100}
										required
										name="maximumProgress"
										label="Maximum progress"
										description="After this value, progress will be marked as completed"
										defaultValue={
											props.integrationData?.maximumProgress || MAXIMUM_PROGRESS
										}
									/>
								</Group>
							) : null}
							{provider && supportsSyncToOwnedCollection(provider) ? (
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
							<Checkbox
								name="isDisabled"
								label="Pause integration"
								defaultChecked={props.integrationData?.isDisabled || undefined}
							/>
							<Checkbox
								label="Disable on continuous errors"
								name="extraSettings.disableOnContinuousErrors"
								description="If the integration fails 5 times in a row, it will be disabled"
								defaultChecked={
									props.integrationData?.extraSettings
										.disableOnContinuousErrors || undefined
								}
							/>
						</Stack>
					</Collapse>
					<Tooltip
						label={PRO_REQUIRED_MESSAGE}
						disabled={!disableCreationButtonBecauseProRequired}
					>
						<Button
							type="submit"
							disabled={disableCreationButtonBecauseProRequired}
						>
							{isUpdating ? "Update" : "Create"}
						</Button>
					</Tooltip>
				</Stack>
			</Form>
		</Modal>
	);
};
