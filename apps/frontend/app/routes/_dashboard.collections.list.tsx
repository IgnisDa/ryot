import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Container,
	Flex,
	Modal,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import {
	Form,
	Link,
	useFetcher,
	useLoaderData,
	useNavigation,
} from "@remix-run/react";
import {
	CreateOrUpdateCollectionDocument,
	DeleteCollectionDocument,
	type UserCollectionsListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconAssembly,
	IconEdit,
	IconPlus,
	IconTrashFilled,
	IconUserCog,
} from "@tabler/icons-react";
import { ClientError } from "graphql-request";
import { useEffect, useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { z } from "zod";
import { confirmWrapper } from "~/components/confirmation";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getUserCollectionsList,
	getUserDetails,
	gqlClient,
	processSubmission,
} from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [userDetails, userCollectionsList] = await Promise.all([
		getUserDetails(request),
		getUserCollectionsList(request),
	]);
	return json({
		collections: userCollectionsList,
		currentUserId: userDetails.id,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Your collections | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		createOrUpdate: async () => {
			const submission = processSubmission(formData, createOrUpdateSchema);
			try {
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
			} catch (e) {
				let message = "An error occurred";
				if (e instanceof ClientError) {
					const err = e.response.errors?.[0].message;
					if (err) message = err;
				}
				return json(
					{},
					{
						status: 400,
						headers: await createToastHeaders({ type: "error", message }),
					},
				);
			}
		},
		delete: async () => {
			const submission = processSubmission(
				formData,
				z.object({ collectionName: z.string() }),
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
	updateId: z.string().optional(),
});

type UpdateCollectionInput = {
	name: string;
	id: string;
	isDefault: boolean;
	description?: string | null;
};

export default function Page() {
	const transition = useNavigation();
	const loaderData = useLoaderData<typeof loader>();

	const [toUpdateCollection, setToUpdateCollection] =
		useState<UpdateCollectionInput>();
	const [
		createOrUpdateModalOpened,
		{ open: createOrUpdateModalOpen, close: createOrUpdateModalClose },
	] = useDisclosure(false);
	useEffect(() => {
		if (transition.state !== "submitting") {
			createOrUpdateModalClose();
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
								createOrUpdateModalOpen();
							}}
						>
							<IconPlus size={20} />
						</ActionIcon>
					</Flex>
					<Tabs defaultValue="userCreated" variant="outline">
						<Tabs.List mb="xs">
							<Tabs.Tab
								value="userCreated"
								leftSection={<IconUserCog size={16} />}
							>
								User created
							</Tabs.Tab>
							<Tabs.Tab
								value="systemCreated"
								leftSection={<IconAssembly size={16} />}
							>
								System created
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="userCreated">
							<SimpleGrid cols={{ base: 1, md: 2 }}>
								{loaderData.collections
									.filter((c) => !c.isDefault)
									.map((c) => (
										<DisplayCollection
											key={c.id}
											collection={c}
											setToUpdateCollection={setToUpdateCollection}
											openModal={createOrUpdateModalOpen}
										/>
									))}
							</SimpleGrid>
						</Tabs.Panel>
						<Tabs.Panel value="systemCreated">
							<SimpleGrid cols={{ base: 1, md: 2 }}>
								{loaderData.collections
									.filter((c) => c.isDefault)
									.map((c) => (
										<DisplayCollection
											key={c.id}
											collection={c}
											setToUpdateCollection={setToUpdateCollection}
											openModal={createOrUpdateModalOpen}
										/>
									))}
							</SimpleGrid>
						</Tabs.Panel>
					</Tabs>
				</Stack>
			</Container>
			<Modal
				opened={createOrUpdateModalOpened}
				onClose={createOrUpdateModalClose}
				withCloseButton={false}
				centered
			>
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
							readOnly={toUpdateCollection?.isDefault}
						/>
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

type Collection = UserCollectionsListQuery["userCollectionsList"][number];

const DisplayCollection = (props: {
	collection: Collection;
	setToUpdateCollection: (c: UpdateCollectionInput) => void;
	openModal: () => void;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const fetcher = useFetcher();
	const deleteFormRef = useRef<HTMLFormElement>(null);
	const additionalDisplay = [`${props.collection.count} items`];

	if (props.collection.creatorUserId !== loaderData.currentUserId)
		additionalDisplay.push(`By ${props.collection.creatorUsername}`);

	return (
		<Flex align="center" justify="space-between" gap="md" mr="lg">
			<Box>
				<Flex align="center" gap="xs">
					<Anchor
						component={Link}
						to={$path("/collections/:id", { id: props.collection.id })}
					>
						<Title order={4}>
							{props.collection.name.slice(0, 20)}
							{props.collection.name.length > 20 ? "..." : ""}
						</Title>
					</Anchor>
					<Text c="dimmed" size="xs">
						({additionalDisplay.join(", ")})
					</Text>
				</Flex>
				{props.collection.description ? (
					<Text lineClamp={1}>{props.collection.description}</Text>
				) : null}
			</Box>
			<Flex gap="sm" style={{ flex: 0 }}>
				<ActionIcon
					color="blue"
					variant="outline"
					onClick={() => {
						props.setToUpdateCollection({
							name: props.collection.name,
							id: props.collection.id,
							description: props.collection.description,
							isDefault: props.collection.isDefault,
						});
						props.openModal();
					}}
				>
					<IconEdit size={18} />
				</ActionIcon>
				{!props.collection.isDefault ? (
					<fetcher.Form
						action="?intent=delete"
						method="post"
						ref={deleteFormRef}
					>
						<input
							hidden
							name="collectionName"
							defaultValue={props.collection.name}
						/>
						<ActionIcon
							color="red"
							variant="outline"
							onClick={async () => {
								const conf = await confirmWrapper({
									confirmation:
										"Are you sure you want to delete this collection?",
								});
								if (conf) fetcher.submit(deleteFormRef.current);
							}}
						>
							<IconTrashFilled size={18} />
						</ActionIcon>
					</fetcher.Form>
				) : null}
			</Flex>
		</Flex>
	);
};
