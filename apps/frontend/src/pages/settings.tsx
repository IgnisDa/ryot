import type { NextPageWithLayout } from "./_app";
import { useCoreDetails, useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { fileToText, getLot } from "@/lib/utilities";
import {
	ActionIcon,
	Alert,
	Anchor,
	Box,
	Button,
	Code,
	Container,
	CopyButton,
	Divider,
	FileInput,
	Flex,
	Modal,
	Paper,
	PasswordInput,
	Select,
	SimpleGrid,
	Stack,
	Switch,
	Tabs,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
	CreateUserSinkIntegrationDocument,
	type CreateUserSinkIntegrationMutationVariables,
	CreateUserYankIntegrationDocument,
	type CreateUserYankIntegrationMutationVariables,
	DeleteUserAuthTokenDocument,
	type DeleteUserAuthTokenMutationVariables,
	DeleteUserDocument,
	DeleteUserIntegrationDocument,
	type DeleteUserIntegrationMutationVariables,
	type DeleteUserMutationVariables,
	DeployImportJobDocument,
	type DeployImportJobMutationVariables,
	GenerateApplicationTokenDocument,
	type GenerateApplicationTokenMutationVariables,
	MediaImportSource,
	ProvidersLanguageInformationDocument,
	RegenerateUserSummaryDocument,
	type RegenerateUserSummaryMutationVariables,
	RegisterUserDocument,
	UpdateAllMetadataDocument,
	type UpdateAllMetadataMutationVariables,
	UpdateUserDocument,
	UpdateUserFeaturePreferenceDocument,
	type UpdateUserFeaturePreferenceMutationVariables,
	type UpdateUserMutationVariables,
	UserAuthTokensDocument,
	UserDetailsDocument,
	type UserInput,
	UserIntegrationsDocument,
	UserLot,
	UserSinkIntegrationLot,
	UserYankIntegrationLot,
	UsersDocument,
	YankIntegrationDataDocument,
	type YankIntegrationDataMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatTimeAgo, randomString } from "@ryot/utilities";
import {
	IconAnalyze,
	IconApps,
	IconCheck,
	IconCopy,
	IconDatabaseImport,
	IconNeedleThread,
	IconPlus,
	IconRefresh,
	IconSignature,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement, useState } from "react";
import { match } from "ts-pattern";
import { z } from "zod";

const registerFormSchema = z.object({
	username: z.string(),
	password: z.string(),
});
type RegisterUserFormSchema = z.infer<typeof registerFormSchema>;

const message = {
	title: "Success",
	message: "Your import has started. Check back later.",
	color: "green",
};
const updateProfileFormSchema = z.object({
	username: z.string().optional(),
	email: z.string().email().optional(),
	password: z.string().optional(),
});
type UpdateProfileFormSchema = z.infer<typeof updateProfileFormSchema>;

const mediaTrackerImportFormSchema = z.object({
	apiUrl: z.string().url(),
	apiKey: z.string(),
});
type MediaTrackerImportFormSchema = z.infer<
	typeof mediaTrackerImportFormSchema
>;

const traktImportFormSchema = z.object({
	username: z.string(),
});
type TraktImportFormSchema = z.infer<typeof traktImportFormSchema>;

const goodreadsImportFormSchema = z.object({
	rssUrl: z.string().url(),
});
type GoodreadsImportFormSchema = z.infer<typeof goodreadsImportFormSchema>;

const movaryImportFormSchema = z.object({
	ratings: z.any(),
	history: z.any(),
});
type MovaryImportFormSchema = z.infer<typeof movaryImportFormSchema>;

const storyGraphImportFormSchema = z.object({
	export: z.any(),
});
type StoryGraphImportFormSchema = z.infer<typeof storyGraphImportFormSchema>;

const createUserYankIntegrationSchema = z.object({
	baseUrl: z.string().url(),
	token: z.string(),
});
type CreateUserYankIntegationSchema = z.infer<
	typeof createUserYankIntegrationSchema
>;

export const ImportSource = (props: {
	children: JSX.Element | JSX.Element[];
}) => {
	return (
		<>
			{props.children}
			<Button
				variant="light"
				color="blue"
				fullWidth
				mt="md"
				type="submit"
				radius="md"
			>
				Import
			</Button>
		</>
	);
};

const Page: NextPageWithLayout = () => {
	const [
		createUserYankIntegrationModalOpened,
		{
			open: openCreateUserYankIntegrationModal,
			close: closeCreateUserYankIntegrationModal,
		},
	] = useDisclosure(false);
	const [
		registerUserModalOpened,
		{ open: openRegisterUserModal, close: closeRegisterUserModal },
	] = useDisclosure(false);
	const [createUserYankIntegrationLot, setCreateUserYankIntegrationLot] =
		useState<UserYankIntegrationLot>();
	const [createUserSinkIntegrationLot, setCreateUserSinkIntegrationLot] =
		useState<UserSinkIntegrationLot>();
	const [deployImportSource, setDeployImportSource] =
		useState<MediaImportSource>();

	const registerUserForm = useForm<RegisterUserFormSchema>({
		validate: zodResolver(registerFormSchema),
	});
	const updateProfileForm = useForm<UpdateProfileFormSchema>({
		validate: zodResolver(updateProfileFormSchema),
	});
	const mediaTrackerImportForm = useForm<MediaTrackerImportFormSchema>({
		validate: zodResolver(mediaTrackerImportFormSchema),
	});
	const goodreadsImportForm = useForm<GoodreadsImportFormSchema>({
		validate: zodResolver(goodreadsImportFormSchema),
	});
	const traktImportForm = useForm<TraktImportFormSchema>({
		validate: zodResolver(traktImportFormSchema),
	});
	const movaryImportForm = useForm<MovaryImportFormSchema>({
		validate: zodResolver(movaryImportFormSchema),
	});
	const storyGraphImportForm = useForm<StoryGraphImportFormSchema>({
		validate: zodResolver(storyGraphImportFormSchema),
	});
	const createUserYankIntegrationForm = useForm<CreateUserYankIntegationSchema>(
		{ validate: zodResolver(createUserYankIntegrationSchema) },
	);

	const userDetails = useQuery({
		queryKey: ["userDetails"],
		queryFn: async () => {
			const { userDetails } = await gqlClient.request(UserDetailsDocument);
			return userDetails;
		},
		onSuccess: (data) => {
			if (data.__typename === "User") {
				updateProfileForm.setValues({
					email: data.email || undefined,
					username: data.name,
				});
				updateProfileForm.resetDirty();
			}
		},
	});

	const coreDetails = useCoreDetails();

	const languageInformation = useQuery(
		["languageInformation"],
		async () => {
			const { providersLanguageInformation } = await gqlClient.request(
				ProvidersLanguageInformationDocument,
			);
			return providersLanguageInformation;
		},
		{ staleTime: Infinity },
	);

	const userAuthTokens = useQuery(
		["userAuthTokens"],
		async () => {
			const { userAuthTokens } = await gqlClient.request(
				UserAuthTokensDocument,
			);
			return userAuthTokens;
		},
		{ staleTime: Infinity },
	);

	const userIntegrations = useQuery(["userIntegrations"], async () => {
		const { userIntegrations } = await gqlClient.request(
			UserIntegrationsDocument,
		);
		return userIntegrations;
	});

	const users = useQuery(["users"], async () => {
		const { users } = await gqlClient.request(UsersDocument);
		return users;
	});

	const registerUser = useMutation({
		mutationFn: async (input: UserInput) => {
			const { registerUser } = await gqlClient.request(RegisterUserDocument, {
				input,
			});
			return registerUser;
		},
		onSuccess(data) {
			users.refetch();
			if (data.__typename === "RegisterError") {
				notifications.show({
					title: "Error with registration",
					message: data.error,
					color: "red",
				});
			} else {
				closeRegisterUserModal();
			}
		},
	});

	const deleteUserAuthToken = useMutation({
		mutationFn: async (variables: DeleteUserAuthTokenMutationVariables) => {
			const { deleteUserAuthToken } = await gqlClient.request(
				DeleteUserAuthTokenDocument,
				variables,
			);
			return deleteUserAuthToken;
		},
		onSuccess: (data) => {
			if (data) {
				userAuthTokens.refetch();
				notifications.show({
					title: "Success",
					message: "Auth token deleted successfully",
					color: "green",
				});
			}
		},
	});

	const deleteUser = useMutation({
		mutationFn: async (variables: DeleteUserMutationVariables) => {
			const { deleteUser } = await gqlClient.request(
				DeleteUserDocument,
				variables,
			);
			return deleteUser;
		},
		onSuccess: (data) => {
			if (data) {
				users.refetch();
				notifications.show({
					title: "Success",
					message: "User deleted successfully",
					color: "green",
				});
			} else {
				notifications.show({
					title: "Unsucessful",
					message: "There was a problem in deleting the user",
					color: "red",
				});
			}
		},
	});

	const updateUser = useMutation({
		mutationFn: async (variables: UpdateUserMutationVariables) => {
			const { updateUser } = await gqlClient.request(
				UpdateUserDocument,
				variables,
			);
			return updateUser;
		},
		onSuccess: () => {
			userDetails.refetch();
			notifications.show({
				title: "Success",
				message: "Profile details updated",
				color: "green",
			});
		},
	});

	const createUserYankIntegration = useMutation({
		mutationFn: async (
			variables: CreateUserYankIntegrationMutationVariables,
		) => {
			const { createUserYankIntegration } = await gqlClient.request(
				CreateUserYankIntegrationDocument,
				variables,
			);
			return createUserYankIntegration;
		},
		onSuccess: () => {
			userIntegrations.refetch();
		},
	});

	const createUserSinkIntegration = useMutation({
		mutationFn: async (
			variables: CreateUserSinkIntegrationMutationVariables,
		) => {
			const { createUserSinkIntegration } = await gqlClient.request(
				CreateUserSinkIntegrationDocument,
				variables,
			);
			return createUserSinkIntegration;
		},
		onSuccess: () => {
			userIntegrations.refetch();
		},
	});

	const deleteUserIntegration = useMutation({
		mutationFn: async (variables: DeleteUserIntegrationMutationVariables) => {
			const { deleteUserIntegration } = await gqlClient.request(
				DeleteUserIntegrationDocument,
				variables,
			);
			return deleteUserIntegration;
		},
		onSuccess: () => {
			userIntegrations.refetch();
		},
	});

	const deployImportJob = useMutation({
		mutationFn: async (variables: DeployImportJobMutationVariables) => {
			const { deployImportJob } = await gqlClient.request(
				DeployImportJobDocument,
				variables,
			);
			return deployImportJob;
		},
		onSuccess: () => {
			notifications.show(message);
		},
	});

	const deployUpdateAllMetadataJobs = useMutation({
		mutationFn: async (_variables: UpdateAllMetadataMutationVariables) => {
			const { updateAllMetadata } = await gqlClient.request(
				UpdateAllMetadataDocument,
			);
			return updateAllMetadata;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "All metadata will be updated in the background",
				color: "green",
			});
		},
	});

	const yankIntegrationData = useMutation({
		mutationFn: async (_variables: YankIntegrationDataMutationVariables) => {
			const { yankIntegrationData } = await gqlClient.request(
				YankIntegrationDataDocument,
			);
			return yankIntegrationData;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Progress data has been syncronized successfully",
				color: "green",
			});
		},
	});

	const regenerateUserSummary = useMutation({
		mutationFn: async (_variables: RegenerateUserSummaryMutationVariables) => {
			const { regenerateUserSummary } = await gqlClient.request(
				RegenerateUserSummaryDocument,
			);
			return regenerateUserSummary;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Summary will be regenerated in the background",
				color: "green",
			});
		},
	});

	const userPrefs = useUserPreferences();

	const updateUserEnabledFeatures = useMutation({
		mutationFn: async (
			variables: UpdateUserFeaturePreferenceMutationVariables,
		) => {
			const { updateUserFeaturePreference } = await gqlClient.request(
				UpdateUserFeaturePreferenceDocument,
				variables,
			);
			return updateUserFeaturePreference;
		},
		onSuccess: () => {
			userPrefs.refetch();
		},
	});

	const generateApplicationToken = useMutation({
		mutationFn: async (
			variables: GenerateApplicationTokenMutationVariables,
		) => {
			const { generateApplicationToken } = await gqlClient.request(
				GenerateApplicationTokenDocument,
				variables,
			);
			return generateApplicationToken;
		},
		onSuccess: () => {
			userAuthTokens.refetch();
		},
	});

	const openProfileUpdateModal = () =>
		modals.openConfirmModal({
			children: (
				<Text size="sm">Are you sure you want to update your profile?</Text>
			),
			onConfirm: () => {
				updateUser.mutate({ input: updateProfileForm.values });
			},
		});

	return userDetails.data &&
		languageInformation.data &&
		userAuthTokens.data &&
		userPrefs.data &&
		userIntegrations.data ? (
		<>
			<Head>
				<title>Settings | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Tabs defaultValue="profile">
						<Tabs.List mb={"sm"}>
							<Tabs.Tab value="profile" icon={<IconUser size="1rem" />}>
								Profile
							</Tabs.Tab>
							<Tabs.Tab
								value="preferences"
								icon={<IconSignature size="1rem" />}
							>
								Preferences
							</Tabs.Tab>
							<Tabs.Tab
								value="import"
								icon={<IconDatabaseImport size="1rem" />}
							>
								Imports
							</Tabs.Tab>
							<Tabs.Tab value="tokens" icon={<IconApps size="1rem" />}>
								Tokens
							</Tabs.Tab>
							<Tabs.Tab
								value="integrations"
								icon={<IconNeedleThread size="1rem" />}
							>
								Integrations
							</Tabs.Tab>
							<Tabs.Tab value="misc" icon={<IconAnalyze size="1rem" />}>
								Miscellaneous
							</Tabs.Tab>
							{userDetails.data.__typename === "User" &&
							userDetails.data.lot === UserLot.Admin ? (
								<Tabs.Tab value="users" icon={<IconUsers size="1rem" />}>
									Users
								</Tabs.Tab>
							) : null}
						</Tabs.List>

						<Tabs.Panel value="profile">
							<Box
								component="form"
								onSubmit={updateProfileForm.onSubmit((_values) => {
									openProfileUpdateModal();
								})}
							>
								<Stack>
									<TextInput
										label="Username"
										{...updateProfileForm.getInputProps("username")}
										disabled={!coreDetails.data?.usernameChangeAllowed}
										description={
											!coreDetails.data?.usernameChangeAllowed &&
											"Username can not be changed on this instance"
										}
										autoFocus
									/>
									<TextInput
										label="Email"
										{...updateProfileForm.getInputProps("email")}
										autoFocus
									/>
									<PasswordInput
										label="Password"
										{...updateProfileForm.getInputProps("password")}
									/>
									<Button type="submit" loading={updateUser.isLoading} w="100%">
										Update
									</Button>
								</Stack>
							</Box>
						</Tabs.Panel>
						<Tabs.Panel value="preferences">
							<Stack>
								<Stack spacing={"xs"}>
									<Title order={3}>Enabled features</Title>
									<SimpleGrid cols={2}>
										{Object.entries(userPrefs.data.featuresEnabled || {}).map(
											([name, isEnabled], idx) => (
												<Switch
													key={idx}
													label={changeCase(name)}
													checked={isEnabled}
													onChange={(ev) => {
														updateUserEnabledFeatures.mutate({
															input: {
																property: getLot(name)!,
																value: ev.currentTarget.checked,
															},
														});
													}}
												/>
											),
										)}
									</SimpleGrid>
								</Stack>
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="tokens">
							<Stack>
								<Button
									color="violet"
									onClick={() => generateApplicationToken.mutate({})}
									loading={generateApplicationToken.isLoading}
								>
									Generate a new token
								</Button>
								{generateApplicationToken.data && (
									<Box>
										<Alert title="This token will be shown only once">
											<Flex align={"center"}>
												<Code>{generateApplicationToken.data}</Code>
												<CopyButton value={generateApplicationToken.data}>
													{({ copied, copy }) => (
														<Tooltip
															label={copied ? "Copied" : "Copy"}
															withArrow
															position="right"
														>
															<ActionIcon
																color={copied ? "teal" : "gray"}
																onClick={copy}
															>
																{copied ? (
																	<IconCheck size="1rem" />
																) : (
																	<IconCopy size="1rem" />
																)}
															</ActionIcon>
														</Tooltip>
													)}
												</CopyButton>
											</Flex>
										</Alert>
									</Box>
								)}
								{userAuthTokens.data.map((a, idx) => (
									<Paper p="xs" withBorder key={idx}>
										<Flex align={"center"} justify={"space-between"}>
											<Box>
												<Text>{a.token.padStart(32, "*")}</Text>
												<Text size="xs">
													last used {formatTimeAgo(a.lastUsedOn)}
												</Text>
											</Box>
											<ActionIcon
												color={"red"}
												variant="outline"
												onClick={() => {
													const yes = confirm(
														"Deleting this token will logout all devices authorized using this token. Are you sure?",
													);
													if (yes)
														deleteUserAuthToken.mutate({ token: a.token });
												}}
											>
												<IconTrash size="1rem" />
											</ActionIcon>
										</Flex>
									</Paper>
								))}
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="import">
							<Box
								component="form"
								onSubmit={async (e) => {
									e.preventDefault();
									const yes = confirm(
										"Are you sure you want to deploy an import job? This action is irreversible.",
									);
									if (yes) {
										if (deployImportSource) {
											const values = await match(deployImportSource)
												.with(MediaImportSource.Goodreads, () => ({
													goodreads: goodreadsImportForm.values,
												}))
												.with(MediaImportSource.Trakt, () => ({
													trakt: traktImportForm.values,
												}))
												.with(MediaImportSource.MediaTracker, () => ({
													mediaTracker: mediaTrackerImportForm.values,
												}))
												.with(MediaImportSource.Movary, async () => ({
													movary: {
														ratings: await fileToText(
															movaryImportForm.values.ratings,
														),
														history: await fileToText(
															movaryImportForm.values.history,
														),
													},
												}))
												.with(MediaImportSource.StoryGraph, async () => ({
													storyGraph: {
														export: await fileToText(
															storyGraphImportForm.values.export,
														),
													},
												}))
												.exhaustive();
											if (values) {
												deployImportJob.mutate({
													input: { source: deployImportSource, ...values },
												});
											}
										}
									}
								}}
							>
								<Stack>
									<Flex justify={"space-between"}>
										<Title order={3}>Import data</Title>
										<Anchor
											size="xs"
											href="https://github.com/IgnisDa/ryot/blob/main/docs/guides/importing.md"
											target="_blank"
										>
											Docs
										</Anchor>
									</Flex>
									<Select
										label="Select a source"
										required
										data={Object.values(MediaImportSource)}
										onChange={(v) => {
											const t = match(v)
												.with("GOODREADS", () => MediaImportSource.Goodreads)
												.with(
													"MEDIA_TRACKER",
													() => MediaImportSource.MediaTracker,
												)
												.with("TRAKT", () => MediaImportSource.Trakt)
												.with("MOVARY", () => MediaImportSource.Movary)
												.with("STORY_GRAPH", () => MediaImportSource.StoryGraph)
												.run();
											if (t) setDeployImportSource(t);
										}}
									/>
									{deployImportSource ? (
										<ImportSource>
											{match(deployImportSource)
												.with(MediaImportSource.MediaTracker, () => (
													<>
														<TextInput
															label="Instance Url"
															required
															{...mediaTrackerImportForm.getInputProps(
																"apiUrl",
															)}
														/>
														<PasswordInput
															mt="sm"
															label="API Key"
															required
															{...mediaTrackerImportForm.getInputProps(
																"apiKey",
															)}
														/>
													</>
												))
												.with(MediaImportSource.Goodreads, () => (
													<>
														<TextInput
															label="RSS URL"
															required
															{...goodreadsImportForm.getInputProps("rssUrl")}
														/>
													</>
												))
												.with(MediaImportSource.Trakt, () => (
													<>
														<TextInput
															label="Username"
															required
															{...traktImportForm.getInputProps("username")}
														/>
													</>
												))
												.with(MediaImportSource.Movary, () => (
													<>
														<FileInput
															label="History CSV file"
															accept=".csv"
															required
															{...movaryImportForm.getInputProps("history")}
														/>
														<FileInput
															label="Ratings CSV file"
															accept=".csv"
															required
															{...movaryImportForm.getInputProps("ratings")}
														/>
													</>
												))
												.with(MediaImportSource.StoryGraph, () => (
													<>
														<FileInput
															label="CSV export file"
															accept=".csv"
															required
															{...storyGraphImportForm.getInputProps("export")}
														/>
													</>
												))
												.exhaustive()}
										</ImportSource>
									) : null}
								</Stack>
							</Box>
						</Tabs.Panel>
						<Tabs.Panel value="misc">
							<Stack>
								<>
									<Box>
										<Title order={4}>Update all metadata</Title>
										<Text>
											Fetch and update the metadata for all the media items that
											are stored. The more media you have, the longer this will
											take.
										</Text>
									</Box>
									<Button
										onClick={() => deployUpdateAllMetadataJobs.mutate({})}
										loading={deployUpdateAllMetadataJobs.isLoading}
									>
										Delpoy job
									</Button>
								</>
								<Divider />
								<>
									<Box>
										<Title order={4}>Synchronize integrations progress</Title>
										<Text>
											Get data from all configured integrations and update
											progress if applicable. The more integrations you have
											enabled, the longer this will take.
										</Text>
									</Box>
									<Button
										onClick={() => yankIntegrationData.mutate({})}
										loading={yankIntegrationData.isLoading}
									>
										Synchronize
									</Button>
								</>
								<Divider />
								<>
									<Box>
										<Title order={4}>Regenerate Summaries</Title>
										<Text>
											Regenerate all pre-computed summaries from the beginning.
											This may be useful if, for some reason, summaries are
											faulty or preconditions have changed. This may take some
											time.
										</Text>
									</Box>
									<Button
										onClick={() => regenerateUserSummary.mutate({})}
										loading={regenerateUserSummary.isLoading}
									>
										Clean and regenerate
									</Button>
								</>
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="integrations">
							<Stack>
								{userIntegrations.data.length > 0 ? (
									userIntegrations.data.map((i, idx) => (
										<Paper p="xs" withBorder key={idx}>
											<Flex align={"center"} justify={"space-between"}>
												<Box>
													<Text size="xs">{i.description}</Text>
													<Text size="xs">{formatTimeAgo(i.timestamp)}</Text>
												</Box>
												<Button
													color="red"
													variant="outline"
													onClick={() => {
														const yes = confirm(
															"Are you sure you want to delete this integration?",
														);
														if (yes)
															deleteUserIntegration.mutate({
																integrationId: i.id,
																integrationLot: i.lot,
															});
													}}
												>
													Delete
												</Button>
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
											component="form"
											onSubmit={createUserYankIntegrationForm.onSubmit(
												(values) => {
													if (createUserYankIntegrationLot) {
														createUserYankIntegration.mutate({
															input: {
																baseUrl: values.baseUrl,
																token: values.token,
																lot: createUserYankIntegrationLot,
															},
														});
													} else if (createUserSinkIntegrationLot) {
														createUserSinkIntegration.mutate({
															input: { lot: createUserSinkIntegrationLot },
														});
													}
													closeCreateUserYankIntegrationModal();
													createUserYankIntegrationForm.reset();
													setCreateUserYankIntegrationLot(undefined);
													setCreateUserSinkIntegrationLot(undefined);
												},
											)}
										>
											<Stack>
												<Select
													label="Select a source"
													required
													withinPortal
													data={[
														...Object.values(UserYankIntegrationLot),
														...Object.values(UserSinkIntegrationLot),
													]}
													onChange={(v) => {
														const t = match(v)
															.with(
																"AUDIOBOOKSHELF",
																() => UserYankIntegrationLot.Audiobookshelf,
															)
															.otherwise(() => undefined);
														if (t) setCreateUserYankIntegrationLot(t);
														const r = match(v)
															.with(
																"JELLYFIN",
																() => UserSinkIntegrationLot.Jellyfin,
															)
															.otherwise(() => undefined);
														if (r) setCreateUserSinkIntegrationLot(r);
													}}
												/>
												{createUserYankIntegrationLot ? (
													<>
														<TextInput
															label="Base Url"
															{...createUserYankIntegrationForm.getInputProps(
																"baseUrl",
															)}
														/>
														<TextInput
															label="Token"
															{...createUserYankIntegrationForm.getInputProps(
																"token",
															)}
														/>
													</>
												) : null}
												<Button
													type="submit"
													loading={
														createUserYankIntegration.isLoading ||
														createUserSinkIntegration.isLoading
													}
												>
													Submit
												</Button>
											</Stack>
										</Box>
									</Modal>
								</Box>
							</Stack>
						</Tabs.Panel>
						{userDetails.data.__typename === "User" &&
						userDetails.data.lot === UserLot.Admin ? (
							<Tabs.Panel value="users">
								<Stack>
									<Flex align={"center"} gap={"md"}>
										<Title order={2}>Users</Title>
										<ActionIcon
											color="green"
											variant="outline"
											onClick={() => {
												registerUserForm.reset();
												openRegisterUserModal();
											}}
										>
											<IconPlus size="1.25rem" />
										</ActionIcon>
									</Flex>
									<Modal
										opened={registerUserModalOpened}
										onClose={closeRegisterUserModal}
										withCloseButton={false}
										centered
									>
										<Box
											component="form"
											onSubmit={registerUserForm.onSubmit((values) => {
												registerUser.mutate(values);
												registerUserForm.reset();
												close();
											})}
										>
											<Stack>
												<Title order={3}>Create User</Title>
												<TextInput
													label="Name"
													required
													{...registerUserForm.getInputProps("username")}
												/>
												<TextInput
													label="Password"
													required
													rightSection={
														<ActionIcon
															onClick={() => {
																registerUserForm.setFieldValue(
																	"password",
																	randomString(5),
																);
															}}
														>
															<IconRefresh size="1rem" />
														</ActionIcon>
													}
													{...registerUserForm.getInputProps("password")}
												/>
												<Button variant="outline" type="submit">
													Create
												</Button>
											</Stack>
										</Box>
									</Modal>
									{users.data
										? users.data.map((user, idx) => (
												<Paper p="xs" withBorder key={idx}>
													<Flex align={"center"} justify={"space-between"}>
														<Box>
															<Text>{user.name}</Text>
															<Text size="xs">
																Role: {changeCase(user.lot)}
															</Text>
														</Box>
														<ActionIcon
															color={"red"}
															variant="outline"
															onClick={() => {
																const yes = confirm(
																	"Are you sure you want to delete this user?",
																);
																if (yes)
																	deleteUser.mutate({
																		toDeleteUserId: user.id,
																	});
															}}
														>
															<IconTrash size="1rem" />
														</ActionIcon>
													</Flex>
												</Paper>
										  ))
										: null}
								</Stack>
							</Tabs.Panel>
						) : null}
					</Tabs>
				</Stack>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
