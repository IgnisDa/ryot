import { APP_ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Container,
	Flex,
	Input,
	Modal,
	SegmentedControl,
	SimpleGrid,
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
	CollectionsDocument,
	CreateOrUpdateCollectionDocument,
	type CreateOrUpdateCollectionMutationVariables,
	DeleteCollectionDocument,
	type DeleteCollectionMutationVariables,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconEdit, IconPlus, IconTrashFilled } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useState } from "react";
import { withQuery } from "ufo";
import { z } from "zod";
import type { NextPageWithLayout } from "../../_app";

const formSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	visibility: z.nativeEnum(Visibility).default(Visibility.Private),
});
type FormSchema = z.infer<typeof formSchema>;

const Page: NextPageWithLayout = () => {
	const [toUpdateCollection, setToUpdateCollection] = useState<number>();
	const [opened, { open, close }] = useDisclosure(false);

	const form = useForm<FormSchema>({
		validate: zodResolver(formSchema),
	});

	const collections = useQuery(["collections"], async () => {
		const { collections } = await gqlClient.request(CollectionsDocument, {});
		return collections;
	});

	const createOrUpdateCollection = useMutation({
		mutationFn: async (
			variables: CreateOrUpdateCollectionMutationVariables,
		) => {
			const { createOrUpdateCollection } = await gqlClient.request(
				CreateOrUpdateCollectionDocument,
				variables,
			);
			return createOrUpdateCollection;
		},
		onSuccess: () => {
			collections.refetch();
			notifications.show({
				title: "Success",
				message: "Collection created/updated successfully",
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
		// biome-ignore lint/suspicious/noExplicitAny: required
		onError: (e: any) => {
			notifications.show({
				title: "Error in operation",
				message: e.response.errors[0].message,
				color: "red",
			});
		},
	});

	return collections.data && collections.data.length >= 1 ? (
		<>
			<Head>
				<title>Collections | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Flex align={"center"} gap={"md"}>
						<Title>Collections</Title>
						<ActionIcon
							color="green"
							variant="outline"
							onClick={() => {
								setToUpdateCollection(undefined);
								form.reset();
								open();
							}}
						>
							<IconPlus size="1.25rem" />
						</ActionIcon>
					</Flex>
					<SimpleGrid cols={1} breakpoints={[{ minWidth: "md", cols: 2 }]}>
						{collections.data.map((c) => (
							<Flex
								key={c?.id}
								align={"center"}
								justify={"space-between"}
								gap="md"
								mr="lg"
							>
								<Box>
									<Flex align={"center"} gap="xs">
										<Link
											href={withQuery(APP_ROUTES.media.collections.details, {
												collectionId: c?.id,
											})}
											passHref
											legacyBehavior
										>
											<Anchor color="gray">
												<Title order={4}>{c?.name}</Title>
											</Anchor>
										</Link>
										<Text color="dimmed" size={"xs"}>
											{c?.numItems} items, {changeCase(c?.visibility || "")}
										</Text>
									</Flex>
									{c?.description ? <Text>{c?.description}</Text> : undefined}
								</Box>
								<Flex gap="sm" style={{ flex: 0 }}>
									<ActionIcon
										color="blue"
										variant="outline"
										onClick={() => {
											setToUpdateCollection(c?.id);
											form.setValues({
												name: c?.name,
												description: c?.description ?? undefined,
												visibility: c?.visibility,
											});
											open();
										}}
									>
										<IconEdit size="1.125rem" />
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
													collectionName: c?.name,
												});
										}}
									>
										<IconTrashFilled size="1.125rem" />
									</ActionIcon>
								</Flex>
							</Flex>
						))}
					</SimpleGrid>
					<Modal
						opened={opened}
						onClose={close}
						withCloseButton={false}
						centered
					>
						<Box
							component="form"
							onSubmit={form.onSubmit((values) => {
								createOrUpdateCollection.mutate({
									input: { ...values, updateId: toUpdateCollection },
								});
								form.reset();
								close();
							})}
						>
							<Stack>
								<Title order={3}>
									{toUpdateCollection ? "Update" : "Create"} collection
								</Title>
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
									{toUpdateCollection ? "Update" : "Create"}
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
