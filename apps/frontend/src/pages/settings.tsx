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
	Group,
	PasswordInput,
	Stack,
	Tabs,
	TextInput,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	DeployMediaTrackerImportDocument,
	type DeployMediaTrackerImportMutationVariables,
	UpdateUserDocument,
	type UpdateUserMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconDatabaseImport,
	IconExternalLink,
	IconUser,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { z } from "zod";

const updateProfileFormSchema = z.object({
	username: z.string().optional(),
	password: z.string().optional(),
	email: z.string().optional(),
});
type UpdateProfileFormSchema = z.infer<typeof updateProfileFormSchema>;

const mediaTrackerImportFormSchema = z.object({
	apiUrl: z.string().url(),
	apiKey: z.string(),
});
type MediaTrackerImportFormSchema = z.infer<
	typeof mediaTrackerImportFormSchema
>;

const Page: NextPageWithLayout = () => {
	const updateProfileForm = useForm<UpdateProfileFormSchema>({
		validate: zodResolver(updateProfileFormSchema),
	});
	const mediaTrackerImportForm = useForm<MediaTrackerImportFormSchema>({
		validate: zodResolver(mediaTrackerImportFormSchema),
	});

	useUser((data) => {
		updateProfileForm.setValues({
			email: data.email,
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

	const deploymediaTrackerImport = useMutation({
		mutationFn: async (
			variables: DeployMediaTrackerImportMutationVariables,
		) => {
			const { deployMediaTrackerImport } = await gqlClient.request(
				DeployMediaTrackerImportDocument,
				variables,
			);
			return deployMediaTrackerImport;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Your import has started. Check back later.",
				color: "green",
			});
		},
	});

	return (
		<Container size="xs">
			<Stack>
				<Tabs defaultValue="profile">
					<Tabs.List mb={"sm"}>
						<Tabs.Tab value="profile" icon={<IconUser size="1rem" />}>
							Profile
						</Tabs.Tab>
						<Tabs.Tab value="import" icon={<IconDatabaseImport size="1rem" />}>
							Import
						</Tabs.Tab>
					</Tabs.List>
					<Tabs.Panel value="profile">
						<Box
							component="form"
							onSubmit={updateProfileForm.onSubmit((values) => {
								updateUser.mutate({ input: values });
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
							<Box>
								<Card
									shadow="sm"
									radius="md"
									withBorder
									padding={"sm"}
									component="form"
									onSubmit={mediaTrackerImportForm.onSubmit((values) => {
										deploymediaTrackerImport.mutate({ input: values });
									})}
								>
									<Group align="center">
										<Title order={3}>Media Tracker</Title>
										<Anchor
											href="https://github.com/bonukai/MediaTracker"
											target="_blank"
										>
											<IconExternalLink size="1rem" />
										</Anchor>
									</Group>

									<TextInput
										label="Instance Url"
										{...mediaTrackerImportForm.getInputProps("apiUrl")}
									/>
									<PasswordInput
										label="API Key"
										{...mediaTrackerImportForm.getInputProps("apiKey")}
									/>

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
						</Stack>
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</Container>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
