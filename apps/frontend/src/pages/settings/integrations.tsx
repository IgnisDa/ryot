import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
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
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import {
	CreateUserSinkIntegrationDocument,
	type CreateUserSinkIntegrationMutationVariables,
	CreateUserYankIntegrationDocument,
	type CreateUserYankIntegrationMutationVariables,
	DeleteUserIntegrationDocument,
	type DeleteUserIntegrationMutationVariables,
	UserIntegrationsDocument,
	UserSinkIntegrationSettingKind,
	UserYankIntegrationSettingKind,
} from "@ryot/generated/graphql/backend/graphql";
import { formatTimeAgo } from "@ryot/ts-utils";
import { IconCopy } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement, useState } from "react";
import { z } from "zod";
import type { NextPageWithLayout } from "../_app";

const createUserYankIntegrationSchema = z.object({
	baseUrl: z.string().url().optional(),
	token: z.string().optional(),
	username: z.string().optional(),
});
type CreateUserYankIntegationSchema = z.infer<
	typeof createUserYankIntegrationSchema
>;

const Page: NextPageWithLayout = () => {
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

	const createUserYankIntegrationForm = useForm<CreateUserYankIntegationSchema>(
		{ validate: zodResolver(createUserYankIntegrationSchema) },
	);

	const userIntegrations = useQuery(["userIntegrations"], async () => {
		const { userIntegrations } = await gqlClient.request(
			UserIntegrationsDocument,
		);
		return userIntegrations;
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

	return userIntegrations.data ? (
		<>
			<Head>
				<title>Integration Settings | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Integration settings</Title>

					{userIntegrations.data.length > 0 ? (
						userIntegrations.data.map((i) => (
							<Paper p="xs" withBorder key={i.id}>
								<Flex align={"center"} justify={"space-between"}>
									<Box>
										<Text size="xs">{i.description}</Text>
										<Text size="xs">{formatTimeAgo(i.timestamp)}</Text>
									</Box>
									<Group>
										{i.slug ? (
											<CopyButton
												value={`${
													window.location.origin
												}/webhooks/integrations/${i.description
													.toLowerCase()
													.split(" ")
													.at(0)}/${i.slug}`}
											>
												{({ copy }) => (
													<ActionIcon color="green" onClick={copy}>
														<IconCopy />
													</ActionIcon>
												)}
											</CopyButton>
										) : undefined}
										<Button
											color="red"
											variant="outline"
											size="xs"
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
									</Group>
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
								onSubmit={createUserYankIntegrationForm.onSubmit((values) => {
									if (createUserYankIntegrationLot) {
										createUserYankIntegration.mutate({
											input: {
												// biome-ignore lint/style/noNonNullAssertion: any is required here
												baseUrl: values.baseUrl!,
												// biome-ignore lint/style/noNonNullAssertion: any is required here
												token: values.token!,
												lot: createUserYankIntegrationLot,
											},
										});
									} else if (createUserSinkIntegrationLot) {
										createUserSinkIntegration.mutate({
											input: {
												lot: createUserSinkIntegrationLot,
												username: values.username,
											},
										});
									}
									closeCreateUserYankIntegrationModal();
									createUserYankIntegrationForm.reset();
									setCreateUserYankIntegrationLot(undefined);
									setCreateUserSinkIntegrationLot(undefined);
								})}
							>
								<Stack>
									<Select
										label="Select a source"
										required
										withinPortal
										data={[
											...Object.values(UserYankIntegrationSettingKind),
											...Object.values(UserSinkIntegrationSettingKind),
										]}
										// biome-ignore lint/suspicious/noExplicitAny: required here
										onChange={(v: any) => {
											if (v) {
												if (
													Object.values(
														UserYankIntegrationSettingKind,
													).includes(v)
												) {
													setCreateUserYankIntegrationLot(
														v as UserYankIntegrationSettingKind,
													);
													setCreateUserSinkIntegrationLot(undefined);
												}
												if (
													Object.values(
														UserSinkIntegrationSettingKind,
													).includes(v)
												) {
													setCreateUserSinkIntegrationLot(
														v as UserSinkIntegrationSettingKind,
													);
													setCreateUserYankIntegrationLot(undefined);
												}
											}
										}}
									/>
									{createUserYankIntegrationLot ? (
										<>
											<TextInput
												label="Base Url"
												required
												{...createUserYankIntegrationForm.getInputProps(
													"baseUrl",
												)}
											/>
											<TextInput
												label="Token"
												required
												{...createUserYankIntegrationForm.getInputProps(
													"token",
												)}
											/>
										</>
									) : undefined}
									{createUserSinkIntegrationLot ===
									UserSinkIntegrationSettingKind.Plex ? (
										<>
											<TextInput
												label="Username"
												{...createUserYankIntegrationForm.getInputProps(
													"username",
												)}
											/>
										</>
									) : undefined}
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
