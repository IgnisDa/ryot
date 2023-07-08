import type { NextPageWithLayout } from "../_app";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Box,
	Button,
	Container,
	Flex,
	Input,
	Modal,
	SegmentedControl,
	Stack,
	Text,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CreateCollectionDocument,
	type CreateCollectionMutationVariables,
	DeleteCollectionDocument,
	type DeleteCollectionMutationVariables,
	PartialCollectionsDocument,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconPlus,
	IconTrashFilled,
	IconWritingSign,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import { z } from "zod";

const formSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	visibility: z.nativeEnum(Visibility).default(Visibility.Private),
});
type FormSchema = z.infer<typeof formSchema>;

const Page: NextPageWithLayout = () => {
	const [opened, { open, close }] = useDisclosure(false);

	const form = useForm<FormSchema>({
		validate: zodResolver(formSchema),
	});

	const collections = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(PartialCollectionsDocument);
		return collections;
	});

	const createCollection = useMutation({
		mutationFn: async (variables: CreateCollectionMutationVariables) => {
			const { createCollection } = await gqlClient.request(
				CreateCollectionDocument,
				variables,
			);
			return createCollection;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Collection created successfully",
				color: "green",
			});
		},
	});

	const deleteCollection = useMutation({
		mutationFn: async (variables: DeleteCollectionMutationVariables) => {
			const { deleteCollection } = await gqlClient.request(
				DeleteCollectionDocument,
				variables,
			);
			return deleteCollection;
		},
		onSuccess: (_data) => {
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
					<Flex align={"center"} justify={"space-between"}>
						<Title>Collections</Title>
						<ActionIcon color="green" variant="outline" onClick={open}>
							<IconPlus size="1.125rem" />
						</ActionIcon>
					</Flex>
					{collections.data.map((c) => (
						<Flex
							key={c.collectionDetails.id}
							align={"center"}
							justify={"space-between"}
							gap="md"
						>
							<Box>
								<Flex align={"center"} gap="xs">
									<Title order={4}>{c.collectionDetails.name}</Title>
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
					<Modal
						opened={opened}
						onClose={close}
						withCloseButton={false}
						centered
					>
						<Box
							component="form"
							onSubmit={form.onSubmit((values) => {
								createCollection.mutate({ input: values });
								form.reset();
								close();
							})}
						>
							<Stack>
								<Title order={3}>Create collection</Title>
								<TextInput
									label="Name"
									required
									{...form.getInputProps("name")}
								/>
								<Box>
									<Input.Label required>Visibility</Input.Label>
									<SegmentedControl
										fullWidth
										data={[
											{
												label: Visibility.Private,
												value: Visibility.Private,
											},
											{
												label: Visibility.Public,
												value: Visibility.Public,
											},
										]}
										{...form.getInputProps("visibility")}
									/>
								</Box>
								<Textarea
									label="Description"
									{...form.getInputProps("description")}
								/>
								<Button variant="outline" type="submit">
									Create
								</Button>
							</Stack>
						</Box>
					</Modal>
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
