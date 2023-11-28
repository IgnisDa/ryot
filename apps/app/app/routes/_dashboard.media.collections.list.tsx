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
import { useDisclosure } from "@mantine/hooks";
import { ActionFunctionArgs, LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import {
	DeleteCollectionDocument,
	UserCollectionsListDocument,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconEdit, IconPlus, IconTrashFilled } from "@tabler/icons-react";
import { useState } from "react";
import { $path } from "remix-routes";
import { namedAction } from "remix-utils/named-action";
import { z } from "zod";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const { userCollectionsList } = await gqlClient.request(
		UserCollectionsListDocument,
		{},
		await getAuthorizationHeader(request),
	);
	return json({ collections: userCollectionsList });
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
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

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [toUpdateCollection, setToUpdateCollection] = useState<number>();
	const [opened, { open, close }] = useDisclosure(false);

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>Collections</Title>
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
								{c.description ? <Text>{c.description}</Text> : undefined}
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
									<IconEdit size={18} />
								</ActionIcon>
								<Form action="?intent=delete" method="post">
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
				<Modal opened={opened} onClose={close} withCloseButton={false} centered>
					<Box component={Form} method="post">
						<Stack>
							<Title order={3}>
								{toUpdateCollection ? "Update" : "Create"} collection
							</Title>
							<TextInput label="Name" required />
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
								/>
							</Box>
							<Textarea label="Description" />
							<Button variant="outline" type="submit">
								{toUpdateCollection ? "Update" : "Create"}
							</Button>
						</Stack>
					</Box>
				</Modal>
			</Stack>
		</Container>
	);
}
