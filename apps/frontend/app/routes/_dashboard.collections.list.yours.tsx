import { $path } from "@ignisda/remix-routes";
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
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconEdit, IconPlus, IconTrashFilled } from "@tabler/icons-react";
import { ClientError } from "graphql-request";
import { useEffect, useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import {
	createToastHeaders,
	getAuthorizationHeader,
	getUserCollectionsList,
	gqlClient,
	processSubmission,
} from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [userCollectionsList] = await Promise.all([
		getUserCollectionsList(request),
	]);
	return json({ collections: userCollectionsList });
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
	visibility: z.nativeEnum(Visibility),
	updateId: zx.IntAsString.optional(),
});

type UpdateCollectionInput = {
	name: string;
	id: number;
	description?: string | null;
	visibility: Visibility;
};

export default function Page() {
	const transition = useNavigation();
	const loaderData = useLoaderData<typeof loader>();

	const [toUpdateCollection, setToUpdateCollection] =
		useState<UpdateCollectionInput>();
	const [opened, { open, close }] = useDisclosure(false);
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
							<DisplayCollection
								key={c.id}
								collection={c}
								setToUpdateCollection={setToUpdateCollection}
								openModal={open}
							/>
						))}
					</SimpleGrid>
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

type Collection = UserCollectionsListQuery["userCollectionsList"][number];

const DisplayCollection = (props: {
	collection: Collection;
	setToUpdateCollection: (c: UpdateCollectionInput) => void;
	openModal: () => void;
}) => {
	const fetcher = useFetcher();
	const deleteFormRef = useRef<HTMLFormElement>(null);

	return (
		<Flex align="center" justify="space-between" gap="md" mr="lg">
			<Box>
				<Flex align="center" gap="xs">
					<Anchor
						component={Link}
						to={$path("/collections/:id", { id: props.collection.id })}
					>
						<Title order={4}>{props.collection.name}</Title>
					</Anchor>
					<Text c="dimmed" size="xs">
						{props.collection.numItems} items,{" "}
						{changeCase(props.collection.visibility || "")}
					</Text>
				</Flex>
				{props.collection.description ? (
					<Text lineClamp={3}>{props.collection.description}</Text>
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
							visibility: props.collection.visibility,
						});
						props.openModal();
					}}
				>
					<IconEdit size={18} />
				</ActionIcon>
				<fetcher.Form action="?intent=delete" method="post" ref={deleteFormRef}>
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
			</Flex>
		</Flex>
	);
};
