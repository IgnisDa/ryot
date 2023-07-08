import type { NextPageWithLayout } from "../_app";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Box,
	Container,
	Flex,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	DeleteCollectionDocument,
	type DeleteCollectionMutationVariables,
	PartialCollectionsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconTrashFilled, IconWritingSign } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const collections = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(PartialCollectionsDocument);
		return collections;
	});

	const deleteCollection = useMutation({
		mutationFn: async (variables: DeleteCollectionMutationVariables) => {
			const { deleteCollection } = await gqlClient.request(
				DeleteCollectionDocument,
				variables,
			);
			return deleteCollection;
		},
		onSuccess: () => {
			collections.refetch();
		},
		onError: (e: any) => {
			notifications.show({
				title: "Error in operation",
				message: e.response.errors[0].message,
				color: "red",
			});
		},
	});

	return collections.data ? (
		<>
			<Head>
				<title>Collections | Ryot</title>
			</Head>
			<Container size={"xs"}>
				<Stack>
					{collections.data.map((c) => (
						<Flex
							key={c.collectionDetails.id}
							align={"center"}
							justify={"space-between"}
							gap="md"
						>
							<Box>
								<Flex align={"center"} gap="xs">
									<Title order={3}>{c.collectionDetails.name}</Title>
									<Text color="dimmed" size={"xs"}>
										({c.collectionDetails.numItems})
									</Text>
								</Flex>
								{c.collectionDetails.description ? (
									<Text>{c.collectionDetails.description}</Text>
								) : null}
							</Box>
							<Flex gap="sm" style={{ flex: 0 }}>
								<ActionIcon color="blue" variant="outline">
									<IconWritingSign size="1.125rem" />
								</ActionIcon>
								<ActionIcon
									color="red"
									variant="outline"
									onClick={() => {
										const yes = confirm(
											"Are you sure you want to delete this collection?",
										);
										if (yes)
											deleteCollection.mutate({
												collectionName: c.collectionDetails.name,
											});
									}}
								>
									<IconTrashFilled size="1.125rem" />
								</ActionIcon>
							</Flex>
						</Flex>
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
