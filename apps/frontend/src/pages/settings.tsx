import type { NextPageWithLayout } from "./_app";
import useUser from "@/lib/hooks/useUser";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Anchor,
	Box,
	Button,
	Card,
	Container,
	Flex,
	PasswordInput,
	Stack,
	Tabs,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
	DeployImportDocument,
	type DeployImportMutationVariables,
	MediaImportSource,
	RegenerateUserSummaryDocument,
	type RegenerateUserSummaryMutationVariables,
	UpdateUserDocument,
	type UpdateUserMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { IconAnalyze, IconDatabaseImport, IconUser } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
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
	profileUrl: z.string().url(),
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

	useUser((data) => {
		updateProfileForm.setValues({
			email: data.email || undefined,
			username: data.name,
		});
		updateProfileForm.resetDirty();
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

	const regenerateUserSummary = useMutation({
		mutationFn: async (_variables: RegenerateUserSummaryMutationVariables) => {
			const { regenerateUserSummary } = await gqlClient.request(
				RegenerateUserSummaryDocument,
			);
			return regenerateUserSummary;
		},
	});

	const openProfileUpdateModal = () =>
		modals.openConfirmModal({
			title: "Confirmation",
			children: (
				<Text size="sm">Are you sure you want to update your profile? </Text>
			),
			centered: true,
			labels: { confirm: "Confirm", cancel: "Cancel" },
			onConfirm: () => {
				updateUser.mutate({ input: updateProfileForm.values });
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
									onSubmit={mediaTrackerImportForm.onSubmit((values) => {
										deployImport.mutate({
											input: {
												mediaTracker: values,
												source: MediaImportSource.MediaTracker,
											},
										});
									})}
									title="Media Tracker"
								>
									<TextInput
										label="Instance Url"
										{...mediaTrackerImportForm.getInputProps("apiUrl")}
									/>
									<PasswordInput
										label="API Key"
										{...mediaTrackerImportForm.getInputProps("apiKey")}
									/>
								</ImportSource>
								<ImportSource
									onSubmit={goodreadsImportForm.onSubmit(async (values) => {
										deployImport.mutate({
											input: {
												source: MediaImportSource.Goodreads,
												goodreads: values,
											},
										});
									})}
									title="Goodreads"
								>
									<TextInput
										label="Profile URL"
										{...goodreadsImportForm.getInputProps("profileUrl")}
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
