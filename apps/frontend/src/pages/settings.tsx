import type { NextPageWithLayout } from "./_app";
import { useEnabledFeatures } from "@/lib/hooks/graphql";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Anchor,
	Box,
	Button,
	Card,
	Container,
	Divider,
	Flex,
	PasswordInput,
	SimpleGrid,
	Space,
	Stack,
	Switch,
	Tabs,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
	CoreDetailsDocument,
	DeployImportDocument,
	type DeployImportMutationVariables,
	MediaImportSource,
	MetadataLot,
	RegenerateUserSummaryDocument,
	type RegenerateUserSummaryMutationVariables,
	UpdateAllMetadataDocument,
	type UpdateAllMetadataMutationVariables,
	UpdateUserDocument,
	type UpdateUserMutationVariables,
	UpdateUserPreferencesDocument,
	type UpdateUserPreferencesMutationVariables,
	UserDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconAnalyze,
	IconDatabaseImport,
	IconSignature,
	IconUser,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import type { ReactElement } from "react";
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
	const updateProfileForm = useForm<UpdateProfileFormSchema>({
		validate: zodResolver(updateProfileFormSchema),
	});
	const mediaTrackerImportForm = useForm<MediaTrackerImportFormSchema>({
		validate: zodResolver(mediaTrackerImportFormSchema),
	});
	const goodreadsImportForm = useForm<GoodreadsImportFormSchema>({
		validate: zodResolver(goodreadsImportFormSchema),
	});

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

	const enabledFeatures = useEnabledFeatures();
	const updateUserPreferences = useMutation({
		mutationFn: async (variables: UpdateUserPreferencesMutationVariables) => {
			const { updateUserPreferences } = await gqlClient.request(
				UpdateUserPreferencesDocument,
				variables,
			);
			return updateUserPreferences;
		},
		onSuccess: () => {
			enabledFeatures.refetch();
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

	return (
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
							<Tabs.Tab value="misc" icon={<IconAnalyze size="1rem" />}>
								Miscellaneous
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
							<Title order={3}>Enabled features</Title>
							<Space h="sm" />
							<SimpleGrid cols={2}>
								<Switch
									label="Audio books"
									checked={enabledFeatures.data?.metadata.audioBooks}
									onChange={(ev) => {
										updateUserPreferences.mutate({
											input: {
												property: MetadataLot.AudioBook,
												value: ev.currentTarget.checked,
											},
										});
									}}
								/>
								<Switch
									label="Books"
									checked={enabledFeatures.data?.metadata.books}
									onChange={(ev) => {
										updateUserPreferences.mutate({
											input: {
												property: MetadataLot.Book,
												value: ev.currentTarget.checked,
											},
										});
									}}
								/>
								<Switch
									label="Movies"
									checked={enabledFeatures.data?.metadata.movies}
									onChange={(ev) => {
										updateUserPreferences.mutate({
											input: {
												property: MetadataLot.Movie,
												value: ev.currentTarget.checked,
											},
										});
									}}
								/>
								<Switch
									label="Podcasts"
									checked={enabledFeatures.data?.metadata.podcasts}
									onChange={(ev) => {
										updateUserPreferences.mutate({
											input: {
												property: MetadataLot.Podcast,
												value: ev.currentTarget.checked,
											},
										});
									}}
								/>
								<Switch
									label="Shows"
									checked={enabledFeatures.data?.metadata.shows}
									onChange={(ev) => {
										updateUserPreferences.mutate({
											input: {
												property: MetadataLot.Show,
												value: ev.currentTarget.checked,
											},
										});
									}}
								/>
								<Switch
									label="Video games"
									checked={enabledFeatures.data?.metadata.videoGames}
									onChange={(ev) => {
										updateUserPreferences.mutate({
											input: {
												property: MetadataLot.VideoGame,
												value: ev.currentTarget.checked,
											},
										});
									}}
								/>
							</SimpleGrid>
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
					</Tabs>
				</Stack>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
