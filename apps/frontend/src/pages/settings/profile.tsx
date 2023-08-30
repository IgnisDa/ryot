import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Button,
	Container,
	PasswordInput,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
	UpdateUserDocument,
	type UpdateUserMutationVariables,
	UserDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import { z } from "zod";
import type { NextPageWithLayout } from "../_app";

const updateProfileFormSchema = z.object({
	username: z.string().optional(),
	email: z.string().email().optional(),
	password: z.string().optional(),
});
type UpdateProfileFormSchema = z.infer<typeof updateProfileFormSchema>;

const Page: NextPageWithLayout = () => {
	const updateProfileForm = useForm<UpdateProfileFormSchema>({
		validate: zodResolver(updateProfileFormSchema),
	});

	const coreDetails = useCoreDetails();

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

	const openProfileUpdateModal = () =>
		modals.openConfirmModal({
			children: (
				<Text size="sm">Are you sure you want to update your profile?</Text>
			),
			onConfirm: () => {
				updateUser.mutate({ input: updateProfileForm.values });
			},
		});

	return coreDetails.data && userDetails.data ? (
		<>
			<Head>
				<title>Profile Settings | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Profile settings</Title>
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
								disabled={!coreDetails.data?.passwordChangeAllowed}
								description={
									!coreDetails.data?.passwordChangeAllowed &&
									"Password can not be changed on this instance"
								}
								{...updateProfileForm.getInputProps("password")}
							/>
							<Button type="submit" loading={updateUser.isLoading} w="100%">
								Update
							</Button>
						</Stack>
					</Box>
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
