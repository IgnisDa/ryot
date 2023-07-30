import type { NextPageWithLayout } from "../_app";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Button,
	Container,
	Flex,
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
	UserSinkIntegrationLot,
	UserYankIntegrationLot,
} from "@ryot/generated/graphql/backend/graphql";
import { formatTimeAgo } from "@ryot/utilities";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement, useState } from "react";
import { match } from "ts-pattern";
import { z } from "zod";

const createUserYankIntegrationSchema = z.object({
	baseUrl: z.string().url().optional(),
	token: z.string().optional(),
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
		useState<UserYankIntegrationLot>();
	const [createUserSinkIntegrationLot, setCreateUserSinkIntegrationLot] =
		useState<UserSinkIntegrationLot>();

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
								onSubmit={createUserYankIntegrationForm.onSubmit((values) => {
									if (createUserYankIntegrationLot) {
										createUserYankIntegration.mutate({
											input: {
												baseUrl: values.baseUrl!,
												token: values.token!,
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
								})}
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
												.with("JELLYFIN", () => UserSinkIntegrationLot.Jellyfin)
												.otherwise(() => undefined);
											if (r) setCreateUserSinkIntegrationLot(r);
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
