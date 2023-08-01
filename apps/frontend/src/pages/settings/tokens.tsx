import type { NextPageWithLayout } from "../_app";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Alert,
	Box,
	Button,
	Code,
	Container,
	CopyButton,
	Flex,
	Paper,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	DeleteUserAuthTokenDocument,
	type DeleteUserAuthTokenMutationVariables,
	GenerateApplicationTokenDocument,
	type GenerateApplicationTokenMutationVariables,
	UserAuthTokensDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { formatTimeAgo } from "@ryot/utilities";
import { IconCheck, IconCopy, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";

const Page: NextPageWithLayout = () => {
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

	return userAuthTokens.data ? (
		<>
			<Head>
				<title>Token Settings | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Token settings</Title>
					<Button
						color="violet"
						onClick={() => generateApplicationToken.mutate({})}
						loading={generateApplicationToken.isLoading}
					>
						Generate a new token
					</Button>
					{generateApplicationToken.data ? (
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
					) : null}
					{userAuthTokens.data.map((a, idx) => (
						<Paper p="xs" withBorder key={idx}>
							<Flex align={"center"} justify={"space-between"}>
								<Box>
									<Text>{a.token.padStart(32, "*")}</Text>
									<Text size="xs">last used {formatTimeAgo(a.lastUsedOn)}</Text>
								</Box>
								<ActionIcon
									color={"red"}
									variant="outline"
									onClick={() => {
										const yes = confirm(
											"Deleting this token will logout all devices authorized using this token. Are you sure?",
										);
										if (yes) deleteUserAuthToken.mutate({ token: a.token });
									}}
								>
									<IconTrash size="1rem" />
								</ActionIcon>
							</Flex>
						</Paper>
					))}
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
