import type { NextPageWithLayout } from "./_app";
import { useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { changeCase, getLot } from "@/lib/utilities";
import {
	ActionIcon,
	Alert,
	Anchor,
	Box,
	Button,
	Card,
	Code,
	Container,
	CopyButton,
	Divider,
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
	CoreDetailsDocument,
	CreateUserYankIntegrationDocument,
	type CreateUserYankIntegrationMutationVariables,
	DeleteUserYankIntegrationDocument,
	type DeleteUserYankIntegrationMutationVariables,
	DeployImportDocument,
	type DeployImportMutationVariables,
	GenerateApplicationTokenDocument,
	type GenerateApplicationTokenMutationVariables,
	MediaImportSource,
	ProvidersLanguageInformationDocument,
	RegenerateUserSummaryDocument,
	type RegenerateUserSummaryMutationVariables,
	UpdateAllMetadataDocument,
	type UpdateAllMetadataMutationVariables,
	UpdateUserDocument,
	UpdateUserFeaturePreferenceDocument,
	type UpdateUserFeaturePreferenceMutationVariables,
	type UpdateUserMutationVariables,
	UserDetailsDocument,
	UserYankIntegrationLot,
	UserYankIntegrationsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconAnalyze,
	IconApps,
	IconCheck,
	IconCopy,
	IconDatabaseImport,
	IconNeedleThread,
	IconSignature,
	IconUser,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import { type ReactElement, useState } from "react";
import { match } from "ts-pattern";
import { z } from "zod";

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

const goodreadsImportFormSchema = z.object({
	rssUrl: z.string().url(),
});
type GoodreadsImportFormSchema = z.infer<typeof goodreadsImportFormSchema>;

const createUserYankIntegrationSchema = z.object({
	baseUrl: z.string().url(),
	token: z.string(),
});
type CreateUserYankIntegationSchema = z.infer<
	typeof createUserYankIntegrationSchema
>;

export const ImportSource = (props: {
	onSubmit: () => void;
	title: string;
	children: JSX.Element[];
}) => {
	return (
		<Box>
			<Card
				shadow="sm"
				radius="md"
				withBorder
				padding={"sm"}
				component="form"
				onSubmit={props.onSubmit}
			>
				<Title order={3} mb="md">
					{props.title}
				</Title>
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
			</Card>
		</Box>
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
	const [createUserYankIntegrationLot, setCreateUserYankIntegrationLot] =
		useState<UserYankIntegrationLot>();

	const updateProfileForm = useForm<UpdateProfileFormSchema>({
		validate: zodResolver(updateProfileFormSchema),
	});
	const mediaTrackerImportForm = useForm<MediaTrackerImportFormSchema>({
		validate: zodResolver(mediaTrackerImportFormSchema),
	});
	const goodreadsImportForm = useForm<GoodreadsImportFormSchema>({
		validate: zodResolver(goodreadsImportFormSchema),
	});
	const createUserYankIntegrationForm = useForm<CreateUserYankIntegationSchema>(
		{
			validate: zodResolver(createUserYankIntegrationSchema),
		},
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

	const coreDetails = useQuery(
		["coreDetails"],
		async () => {
			const { coreDetails } = await gqlClient.request(CoreDetailsDocument);
			return coreDetails;
		},
		{ staleTime: Infinity },
	);

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

	const userYankIntegrations = useQuery(["userYankIntegrations"], async () => {
		const { userYankIntegrations } = await gqlClient.request(
			UserYankIntegrationsDocument,
		);
		return userYankIntegrations;
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
			userYankIntegrations.refetch();
		},
	});

	const deleteUserYankIntegration = useMutation({
		mutationFn: async (
			variables: DeleteUserYankIntegrationMutationVariables,
		) => {
			const { deleteUserYankIntegration } = await gqlClient.request(
				DeleteUserYankIntegrationDocument,
				variables,
			);
			return deleteUserYankIntegration;
		},
		onSuccess: () => {
			userYankIntegrations.refetch();
		},
	});

	const deployImport = useMutation({
		mutationFn: async (variables: DeployImportMutationVariables) => {
			const { deployImport } = await gqlClient.request(
				DeployImportDocument,
				variables,
			);
			return deployImport;
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

	const openGoodreadsImportModal = () =>
		modals.openConfirmModal({
			children: (
				<Text size="sm">
					Are you sure you want to import from Goodreads? This action is
					irreversible.
				</Text>
			),
			onConfirm: () => {
				deployImport.mutate({
					input: {
						goodreads: goodreadsImportForm.values,
						source: MediaImportSource.Goodreads,
					},
				});
			},
		});

	const openMediaTrackerImportModal = () =>
		modals.openConfirmModal({
			children: (
				<Text size="sm">
					Are you sure you want to import from Media Tracker? This action is
					irreversible.
				</Text>
			),
			onConfirm: () => {
				deployImport.mutate({
					input: {
						mediaTracker: mediaTrackerImportForm.values,
						source: MediaImportSource.MediaTracker,
					},
				});
			},
		});

	return languageInformation.data &&
		userPrefs.data &&
		userYankIntegrations.data ? (
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
							<Tabs.Tab value="misc" icon={<IconAnalyze size="1rem" />}>
								Misc
							</Tabs.Tab>
							<Tabs.Tab
								value="integrations"
								icon={<IconNeedleThread size="1rem" />}
							>
								Integrations
							</Tabs.Tab>
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
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="import">
							<Stack>
								<Flex justify={"end"}>
									<Anchor
										size="xs"
										href="https://github.com/IgnisDa/ryot/blob/main/docs/guides/importing.md"
										target="_blank"
									>
										Docs
									</Anchor>
								</Flex>
								<ImportSource
									onSubmit={mediaTrackerImportForm.onSubmit((_values) => {
										openMediaTrackerImportModal();
									})}
									title="Media Tracker"
								>
									<TextInput
										label="Instance Url"
										required
										{...mediaTrackerImportForm.getInputProps("apiUrl")}
									/>
									<PasswordInput
										mt="sm"
										label="API Key"
										required
										{...mediaTrackerImportForm.getInputProps("apiKey")}
									/>
								</ImportSource>
								<ImportSource
									onSubmit={goodreadsImportForm.onSubmit((_values) => {
										openGoodreadsImportModal();
									})}
									title="Goodreads"
								>
									<TextInput
										label="RSS URL"
										required
										{...goodreadsImportForm.getInputProps("rssUrl")}
									/>
									<></>
								</ImportSource>
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="misc">
							<Stack>
								<Box>
									<Title order={4}>Regenerate Summaries</Title>
									<Text>
										Regenerate all pre-computed summaries from the beginning.
										This may be useful if, for some reason, summaries are faulty
										or preconditions have changed. This may take some time.
									</Text>
								</Box>
								<Button
									color="red"
									onClick={() => regenerateUserSummary.mutate({})}
									loading={regenerateUserSummary.isLoading}
								>
									Clean and regenerate
								</Button>
								<Divider />
								<Box>
									<Title order={4}>Update all metadata</Title>
									<Text>
										Fetch and update the metadata for all the media items that
										are stored. The more media you have, the longer this will
										take.
									</Text>
								</Box>
								<Button
									color="red"
									onClick={() => deployUpdateAllMetadataJobs.mutate({})}
									loading={deployUpdateAllMetadataJobs.isLoading}
								>
									Update All
								</Button>
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="integrations">
							<Stack>
								{userYankIntegrations.data.length > 0 ? (
									userYankIntegrations.data.map((i, idx) => (
										<Paper p="xs" withBorder key={idx}>
											<Flex align={"center"} justify={"space-between"}>
												<Box>
													<Text>{i.lot}</Text>
													<Text size="xs">
														Connected to{" "}
														<Anchor href={i.description}>
															{i.description}{" "}
														</Anchor>
													</Text>
													<Text size="xs">
														on{" "}
														{DateTime.fromJSDate(i.timestamp).toLocaleString(
															DateTime.DATE_MED,
														)}
													</Text>
												</Box>
												<Button
													color="red"
													variant="outline"
													onClick={() => {
														const yes = confirm(
															"Are you sure you want to delete this integration?",
														);
														if (yes)
															deleteUserYankIntegration.mutate({
																yankIntegrationId: i.id,
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
														closeCreateUserYankIntegrationModal();
														setCreateUserYankIntegrationLot(undefined);
													}
												},
											)}
										>
											<Stack>
												<Select
													label="Select a source"
													withinPortal
													data={Object.values(UserYankIntegrationLot)}
													onChange={(v) => {
														const t = match(v)
															.with(
																"AUDIOBOOKSHELF",
																() => UserYankIntegrationLot.Audiobookshelf,
															)
															.run();
														if (t) setCreateUserYankIntegrationLot(t);
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
														<Button
															type="submit"
															loading={createUserYankIntegration.isLoading}
														>
															Submit
														</Button>
													</>
												) : null}
											</Stack>
										</Box>
									</Modal>
								</Box>
							</Stack>
						</Tabs.Panel>
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
