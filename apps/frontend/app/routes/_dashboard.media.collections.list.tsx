import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Container,
	Divider,
	Flex,
	Group,
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
import { useDisclosure } from "@mantine/hooks";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import {
	CreateOrUpdateCollectionDocument,
	DeleteCollectionDocument,
	PublicCollectionsListDocument,
	UserCollectionsListDocument,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconEdit, IconPlus, IconTrashFilled } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid } from "~/components/common";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { useGetMantineColor } from "~/lib/hooks";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.optional(),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ userCollectionsList }, { publicCollectionsList }] =
		await Promise.all([
			gqlClient.request(
				UserCollectionsListDocument,
				{},
				await getAuthorizationHeader(request),
			),
			gqlClient.request(PublicCollectionsListDocument, { input: query }),
		]);
	return json({ collections: userCollectionsList, publicCollectionsList });
};

export const meta: MetaFunction = () => {
	return [{ title: "Collections | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		createOrUpdate: async () => {
			const submission = processSubmission(formData, createOrUpdateSchema);
			await gqlClient.request(
				CreateOrUpdateCollectionDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			return json(
				{},
				{
					headers: await createToastHeaders({
						type: "success",
						message: submission.updateId
							? "Collection updated"
							: "Collection created",
					}),
				},
			);
		},
		delete: async () => {
			const submission = processSubmission(
				formData,
				z.object({
					collectionName: z.string(),
				}),
			);
			let wasSuccessful = true;
			try {
				await gqlClient.request(
					DeleteCollectionDocument,
					submission,
					await getAuthorizationHeader(request),
				);
			} catch {
				wasSuccessful = false;
			}
			return json(
				{},
				{
					headers: await createToastHeaders({
						type: wasSuccessful ? "success" : "error",
						message: wasSuccessful
							? "Collection deleted"
							: "Can not delete a default collection",
					}),
				},
			);
		},
	});
};

const createOrUpdateSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	visibility: z.nativeEnum(Visibility),
	updateId: zx.IntAsString.optional(),
});

export default function Page() {
	const transition = useNavigation();
	const loaderData = useLoaderData<typeof loader>();
	const getMantineColor = useGetMantineColor();
	const [toUpdateCollection, setToUpdateCollection] = useState<{
		name: string;
		id: number;
		description?: string | null;
		visibility: Visibility;
	}>();
	const [opened, { open, close }] = useDisclosure(false);
	const formRef = useRef<HTMLFormElement>(null);

	useEffect(() => {
		if (transition.state !== "submitting") {
			close();
			setToUpdateCollection(undefined);
		}
	}, [transition.state]);

	return (
		<>
			<Container>
				<Stack>
					<Flex align="center" gap="md">
						<Title>Your collections</Title>
						<ActionIcon
							color="green"
							variant="outline"
							onClick={() => {
								setToUpdateCollection(undefined);
								open();
							}}
						>
							<IconPlus size={20} />
						</ActionIcon>
					</Flex>
					<SimpleGrid cols={{ base: 1, md: 2 }}>
						{loaderData.collections.map((c) => (
							<Flex
								key={c.id}
								align="center"
								justify="space-between"
								gap="md"
								mr="lg"
							>
								<Box>
									<Flex align="center" gap="xs">
										<Anchor
											component={Link}
											to={$path("/media/collections/:id", { id: c.id })}
										>
											<Title order={4}>{c.name}</Title>
										</Anchor>
										<Text c="dimmed" size="xs">
											{c.numItems} items, {changeCase(c.visibility || "")}
										</Text>
									</Flex>
									{c.description ? (
										<Text lineClamp={3}>{c.description}</Text>
									) : undefined}
								</Box>
								<Flex gap="sm" style={{ flex: 0 }}>
									<ActionIcon
										color="blue"
										variant="outline"
										onClick={() => {
											setToUpdateCollection({
												name: c.name,
												id: c.id,
												description: c.description,
												visibility: c.visibility,
											});
											open();
										}}
									>
										<IconEdit size={18} />
									</ActionIcon>
									<Form action="?intent=delete" method="post" ref={formRef}>
										<ActionIcon
											color="red"
											variant="outline"
											type="submit"
											name="collectionName"
											value={c.name}
											onClick={(e) => {
												if (
													!confirm(
														"Are you sure you want to delete this collection?",
													)
												) {
													e.preventDefault();
												}
											}}
										>
											<IconTrashFilled size={18} />
										</ActionIcon>
									</Form>
								</Flex>
							</Flex>
						))}
					</SimpleGrid>
					<Divider mt="xl" />
					<Flex align="center" gap="xs">
						<Title>Public collections</Title>
						<Text c="dimmed">
							{loaderData.publicCollectionsList.details.total} items
						</Text>
					</Flex>
					<ApplicationGrid>
						{loaderData.publicCollectionsList.items.map((c) => (
							<Group key={c.id}>
								<Box
									h={11}
									w={11}
									style={{ borderRadius: 2 }}
									bg={getMantineColor(c.name)}
								/>
								<Box>
									<Anchor
										component={Link}
										to={$path("/media/collections/:id", { id: c.id })}
									>
										<Title order={4}>{c.name}</Title>
									</Anchor>
									<Text c="dimmed" size="xs">
										by {c.username}
									</Text>
								</Box>
							</Group>
						))}
					</ApplicationGrid>
				</Stack>
			</Container>
			<Modal opened={opened} onClose={close} withCloseButton={false} centered>
				<Box component={Form} method="post" action="?intent=createOrUpdate">
					<Stack>
						<Title order={3}>
							{toUpdateCollection ? "Update" : "Create"} collection
						</Title>
						<TextInput
							label="Name"
							required
							name="name"
							defaultValue={
								toUpdateCollection ? toUpdateCollection.name : undefined
							}
						/>
						<Box>
							<Input.Label>Visibility</Input.Label>
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
								name="visibility"
								defaultValue={
									toUpdateCollection
										? toUpdateCollection.visibility
										: Visibility.Private
								}
							/>
						</Box>
						<Textarea
							label="Description"
							name="description"
							defaultValue={
								toUpdateCollection?.description
									? toUpdateCollection.description
									: undefined
							}
						/>
						<Button
							variant="outline"
							type="submit"
							name={toUpdateCollection ? "updateId" : undefined}
							value={toUpdateCollection ? toUpdateCollection.id : undefined}
						>
							{toUpdateCollection ? "Update" : "Create"}
						</Button>
					</Stack>
				</Box>
			</Modal>
		</>
	);
}
