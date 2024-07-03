import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Container,
	Flex,
	Group,
	Image,
	Modal,
	Paper,
	Stack,
	Text,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	Link,
	type MetaArgs_SingleFetch,
	useFetcher,
	useNavigation,
} from "@remix-run/react";
import {
	CreateOrUpdateCollectionDocument,
	DeleteCollectionDocument,
	type UserCollectionsListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { truncate } from "@ryot/ts-utils";
import { IconEdit, IconPlus, IconTrashFilled } from "@tabler/icons-react";
import { ClientError } from "graphql-request";
import { useEffect, useRef, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { withQuery } from "ufo";
import { z } from "zod";
import { confirmWrapper } from "~/components/confirmation";
import { getFallbackImageUrl } from "~/lib/generals";
import { useUserCollections, useUserDetails } from "~/lib/hooks";
import {
	createToastHeaders,
	getAuthorizationHeader,
	processSubmission,
	removeCachedUserCollectionsList,
	serverGqlService,
} from "~/lib/utilities.server";

export const loader = unstable_defineLoader(async (_args) => {
	return {};
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Your collections | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	await removeCachedUserCollectionsList(request);
	return namedAction(request, {
		createOrUpdate: async () => {
			const submission = processSubmission(formData, createOrUpdateSchema);
			try {
				await serverGqlService.request(
					CreateOrUpdateCollectionDocument,
					{ input: submission },
					getAuthorizationHeader(request),
				);
				return Response.json(
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
				return Response.json(
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
				await serverGqlService.request(
					DeleteCollectionDocument,
					submission,
					getAuthorizationHeader(request),
				);
			} catch {
				wasSuccessful = false;
			}
			return Response.json(
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
});

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
	const collections = useUserCollections();

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
		<Container size="sm">
			<Stack gap="xl">
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
					<Modal
						opened={createOrUpdateModalOpened}
						onClose={createOrUpdateModalClose}
						withCloseButton={false}
						centered
						size="lg"
					>
						<CreateOrUpdateModal toUpdateCollection={toUpdateCollection} />
					</Modal>
				</Flex>
				{collections.length > 0 ? (
					collections.map((c) => (
						<DisplayCollection
							key={c.id}
							collection={c}
							setToUpdateCollection={setToUpdateCollection}
							openModal={createOrUpdateModalOpen}
						/>
					))
				) : (
					<Text>You have not created any collections yet</Text>
				)}
			</Stack>
		</Container>
	);
}

type Collection = UserCollectionsListQuery["userCollectionsList"][number];

const DisplayCollection = (props: {
	collection: Collection;
	setToUpdateCollection: (c: UpdateCollectionInput) => void;
	openModal: () => void;
}) => {
	const userDetails = useUserDetails();
	const fetcher = useFetcher<typeof action>();
	const deleteFormRef = useRef<HTMLFormElement>(null);
	const additionalDisplay = [];

	if (props.collection.creator.id !== userDetails.id)
		additionalDisplay.push(`By ${props.collection.creator.name}`);
	if (props.collection.count > 0)
		additionalDisplay.push(`${props.collection.count} items`);
	if (props.collection.collaborators.length > 0)
		additionalDisplay.push(
			`${props.collection.collaborators.length} collaborators`,
		);

	return (
		<Flex gap="xs" direction={{ base: "column", md: "row" }}>
			<Image
				src={getFallbackImageUrl("dark", props.collection.name)}
				radius="md"
				h={180}
				w={250}
				flex="none"
			/>
			<Paper withBorder p="xs" flex={1}>
				<Stack h={"100%"}>
					<Group justify="space-between">
						<Anchor
							component={Link}
							to={$path("/collections/:id", { id: props.collection.id })}
						>
							<Title order={4}>
								{truncate(props.collection.name, { length: 20 })}
							</Title>
						</Anchor>
						<Group gap="md">
							{additionalDisplay.length > 0 ? (
								<Text c="dimmed" size="xs">
									({additionalDisplay.join(", ")})
								</Text>
							) : null}
							{userDetails.id === props.collection.creator.id ? (
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
							) : null}
							{!props.collection.isDefault ? (
								<fetcher.Form
									method="POST"
									ref={deleteFormRef}
									action={withQuery("", { intent: "delete" })}
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
						</Group>
					</Group>
					{props.collection.description ? (
						<Text lineClamp={1}>{props.collection.description}</Text>
					) : null}
					{props.collection.isDefault ? (
						<Text lineClamp={1} mt="auto" ta="right" c="dimmed" size="xs">
							System created
						</Text>
					) : null}
				</Stack>
			</Paper>
		</Flex>
	);
};

const CreateOrUpdateModal = (props: {
	toUpdateCollection: UpdateCollectionInput | undefined;
}) => {
	return (
		<Box
			method="POST"
			component={Form}
			action={withQuery("", { intent: "createOrUpdate" })}
		>
			<Stack>
				<Title order={3}>
					{props.toUpdateCollection ? "Update" : "Create"} collection
				</Title>
				<TextInput
					label="Name"
					required
					name="name"
					defaultValue={
						props.toUpdateCollection ? props.toUpdateCollection.name : undefined
					}
					readOnly={props.toUpdateCollection?.isDefault}
				/>
				<Textarea
					label="Description"
					name="description"
					defaultValue={
						props.toUpdateCollection?.description
							? props.toUpdateCollection.description
							: undefined
					}
					autosize
				/>
				<Button
					variant="outline"
					type="submit"
					name={props.toUpdateCollection ? "updateId" : undefined}
					value={
						props.toUpdateCollection ? props.toUpdateCollection.id : undefined
					}
				>
					{props.toUpdateCollection ? "Update" : "Create"}
				</Button>
			</Stack>
		</Box>
	);
};
