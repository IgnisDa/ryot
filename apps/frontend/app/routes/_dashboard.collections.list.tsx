import { useAutoAnimate } from "@formkit/auto-animate/react";
import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Checkbox,
	Container,
	Flex,
	Group,
	Input,
	Modal,
	MultiSelect,
	Paper,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { useDisclosure, useListState } from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	Link,
	type MetaArgs_SingleFetch,
	useFetcher,
	useLoaderData,
	useNavigation,
} from "@remix-run/react";
import {
	type CollectionExtraInformation,
	CollectionExtraInformationLot,
	CreateOrUpdateCollectionDocument,
	DeleteCollectionDocument,
	type UserCollectionsListQuery,
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import {
	IconAssembly,
	IconEdit,
	IconPlus,
	IconTrash,
	IconTrashFilled,
	IconUserCog,
} from "@tabler/icons-react";
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
	getUserDetails,
	processSubmission,
	serverGqlService,
} from "~/lib/utilities.server";

export const loader = unstable_defineLoader(async ({ request }) => {
	const [userDetails, collections, { usersList }] = await Promise.all([
		getUserDetails(request),
		getUserCollectionsList(request),
		serverGqlService.request(
			UsersListDocument,
			undefined,
			await getAuthorizationHeader(request),
		),
	]);
	return { collections, currentUserId: userDetails.id, usersList };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Your collections | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		createOrUpdate: async () => {
			const submission = processSubmission(formData, createOrUpdateSchema);
			try {
				await serverGqlService.request(
					CreateOrUpdateCollectionDocument,
					{ input: submission },
					await getAuthorizationHeader(request),
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
					await getAuthorizationHeader(request),
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
	collaborators: z
		.string()
		.optional()
		.transform((v) => (v ? v.split(",") : undefined)),
	informationTemplate: z
		.array(
			z.object({
				name: z.string(),
				description: z.string(),
				lot: z.nativeEnum(CollectionExtraInformationLot),
				defaultValue: z.string().optional(),
				required: zx.CheckboxAsString.optional(),
			}),
		)
		.optional(),
});

type UpdateCollectionInput = {
	name: string;
	id: string;
	isDefault: boolean;
	collaborators: Collection["collaborators"];
	description?: string | null;
	informationTemplate?: CollectionExtraInformation[] | null;
};

export default function Page() {
	const transition = useNavigation();
	const loaderData = useLoaderData<typeof loader>();
	const userCreatedCollections = loaderData.collections.filter(
		(c) => !c.isDefault,
	);

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
							{userCreatedCollections.length > 0 ? (
								<SimpleGrid cols={{ base: 1, md: 2 }}>
									{userCreatedCollections.map((c) => (
										<DisplayCollection
											key={c.id}
											collection={c}
											setToUpdateCollection={setToUpdateCollection}
											openModal={createOrUpdateModalOpen}
										/>
									))}
								</SimpleGrid>
							) : (
								<Text>You have not created any collections yet</Text>
							)}
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
				size="lg"
			>
				<CreateOrUpdateModal toUpdateCollection={toUpdateCollection} />
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
	const fetcher = useFetcher<typeof action>();
	const deleteFormRef = useRef<HTMLFormElement>(null);
	const additionalDisplay = [];

	if (props.collection.creator.id !== loaderData.currentUserId)
		additionalDisplay.push(`By ${props.collection.creator.name}`);
	if (props.collection.count > 0)
		additionalDisplay.push(`${props.collection.count} items`);
	if (props.collection.collaborators.length > 0)
		additionalDisplay.push(
			`${props.collection.collaborators.length} collaborators`,
		);

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
					{additionalDisplay.length > 0 ? (
						<Text c="dimmed" size="xs">
							({additionalDisplay.join(", ")})
						</Text>
					) : undefined}
				</Flex>
				{props.collection.description ? (
					<Text lineClamp={1}>{props.collection.description}</Text>
				) : null}
			</Box>
			<Flex gap="sm" style={{ flex: 0 }}>
				{loaderData.currentUserId === props.collection.creator.id ? (
					<ActionIcon
						color="blue"
						variant="outline"
						onClick={() => {
							props.setToUpdateCollection({
								name: props.collection.name,
								id: props.collection.id,
								description: props.collection.description,
								collaborators: props.collection.collaborators,
								isDefault: props.collection.isDefault,
								informationTemplate: props.collection.informationTemplate,
							});
							props.openModal();
						}}
					>
						<IconEdit size={18} />
					</ActionIcon>
				) : undefined}
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

const CreateOrUpdateModal = (props: {
	toUpdateCollection: UpdateCollectionInput | undefined;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [parent] = useAutoAnimate();
	const [informationTemplate, setInformationTemplate] =
		useListState<CollectionExtraInformation>(
			props.toUpdateCollection?.informationTemplate || [],
		);

	return (
		<Box component={Form} method="post" action="?intent=createOrUpdate">
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
				<MultiSelect
					name="collaborators"
					description="Add collaborators to this collection"
					searchable
					defaultValue={(props.toUpdateCollection?.collaborators || []).map(
						(c) => c.id,
					)}
					data={loaderData.usersList.map((u) => ({
						value: u.id,
						label: u.name,
						disabled: u.id === loaderData.currentUserId,
					}))}
				/>
				<Input.Wrapper
					labelProps={{ w: "100%" }}
					label={
						<Group wrap="nowrap" justify="space-between">
							<Input.Label size="xs">Information template</Input.Label>
							<Anchor
								size="xs"
								onClick={() =>
									setInformationTemplate.append({
										name: "",
										description: "",
										lot: CollectionExtraInformationLot.String,
									})
								}
							>
								Add field
							</Anchor>
						</Group>
					}
					description="Associate extra information when adding an entity to this collection"
				>
					<Stack gap="xs" mt="xs" ref={parent}>
						{informationTemplate.map((field, index) => (
							<Paper withBorder key={index.toString()} p="xs">
								<TextInput
									label="Name"
									required
									name={`informationTemplate[${index}].name`}
									size="xs"
									defaultValue={field.name}
								/>
								<Textarea
									label="Description"
									required
									name={`informationTemplate[${index}].description`}
									size="xs"
									defaultValue={field.description}
								/>
								<Group wrap="nowrap">
									<Select
										label="Input type"
										required
										name={`informationTemplate[${index}].lot`}
										data={Object.values(CollectionExtraInformationLot).map(
											(lot) => ({ value: lot, label: changeCase(lot) }),
										)}
										size="xs"
										defaultValue={field.lot}
									/>
									<TextInput
										label="Default value"
										name={`informationTemplate[${index}].defaultValue`}
										size="xs"
										defaultValue={field.defaultValue || undefined}
									/>
								</Group>
								<Group mt="xs" justify="space-around">
									<Checkbox
										label="Required"
										name={`informationTemplate[${index}].required`}
										size="sm"
										defaultChecked={field.required || undefined}
									/>
									<Button
										size="xs"
										variant="subtle"
										color="red"
										leftSection={<IconTrash />}
										onClick={() => setInformationTemplate.remove(index)}
									>
										Remove field
									</Button>
								</Group>
							</Paper>
						))}
					</Stack>
				</Input.Wrapper>
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
