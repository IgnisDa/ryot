import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Checkbox,
	Container,
	Flex,
	Group,
	Image,
	Input,
	Modal,
	MultiSelect,
	Paper,
	Select,
	Stack,
	Text,
	TextInput,
	Textarea,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	useDidUpdate,
	useDisclosure,
	useHover,
	useListState,
} from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	Link,
	type MetaArgs_SingleFetch,
	useLoaderData,
	useNavigation,
	useSearchParams,
} from "@remix-run/react";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	type CollectionExtraInformation,
	CollectionExtraInformationLot,
	CreateOrUpdateCollectionDocument,
	DeleteCollectionDocument,
	EntityLot,
	GraphqlSortOrder,
	type UserCollectionsListQuery,
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	isString,
	processSubmission,
	truncate,
} from "@ryot/ts-utils";
import {
	IconEdit,
	IconPlus,
	IconTrash,
	IconTrashFilled,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { ClientError } from "graphql-request";
import { useEffect, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { $path } from "remix-routes";
import { namedAction } from "remix-utils/named-action";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput, ProRequiredAlert } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import {
	clientGqlService,
	dayjsLib,
	getPartialMetadataDetailsQuery,
	queryClient,
	queryFactory,
} from "~/lib/generals";
import {
	useConfirmSubmit,
	useCoreDetails,
	useFallbackImageUrl,
	useUserCollections,
	useUserDetails,
} from "~/lib/hooks";
import {
	createToastHeaders,
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	removeCachedUserCollectionsList,
	serverGqlService,
} from "~/lib/utilities.server";

export const loader = unstable_defineLoader(async ({ request }) => {
	const cookieName = await getEnhancedCookieName("collections.list", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const [{ usersList }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UsersListDocument, {}),
	]);
	return { usersList, cookieName };
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
				await serverGqlService.authenticatedRequest(
					request,
					CreateOrUpdateCollectionDocument,
					{ input: submission },
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
				console.error(e);
				return Response.json(
					{ error: JSON.stringify(e) },
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
				await serverGqlService.authenticatedRequest(
					request,
					DeleteCollectionDocument,
					submission,
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
	const collections = useUserCollections();
	const loaderData = useLoaderData<typeof loader>();
	const [params] = useSearchParams();
	const query = params.get("query") || undefined;

	const filteredCollections = collections.filter((c) =>
		query ? c.name.toLowerCase().includes(query.toLowerCase()) : true,
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
		<Container size="sm">
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
				<DebouncedSearchInput
					initialValue={query}
					enhancedQueryParams={loaderData.cookieName}
				/>
				<Virtuoso
					style={{ height: "80vh" }}
					data={filteredCollections}
					itemContent={(index) => {
						const c = filteredCollections[index];
						return (
							<DisplayCollection
								key={c.id}
								index={index}
								collection={c}
								setToUpdateCollection={setToUpdateCollection}
								openModal={createOrUpdateModalOpen}
							/>
						);
					}}
				/>
			</Stack>
		</Container>
	);
}

type Collection = UserCollectionsListQuery["userCollectionsList"][number];

const IMAGES_CONTAINER_WIDTH = 250;

const DisplayCollection = (props: {
	collection: Collection;
	index: number;
	setToUpdateCollection: (c: UpdateCollectionInput) => void;
	openModal: () => void;
}) => {
	const userDetails = useUserDetails();
	const coreDetails = useCoreDetails();
	const submit = useConfirmSubmit();
	const fallbackImageUrl = useFallbackImageUrl(props.collection.name);
	const additionalDisplay = [];

	const { data: collectionImages } = useQuery({
		queryKey: queryFactory.collections.images(props.collection.id).queryKey,
		queryFn: async () => {
			const { collectionContents } = await clientGqlService.request(
				CollectionContentsDocument,
				{
					input: {
						collectionId: props.collection.id,
						take: 10,
						sort: {
							by: CollectionContentsSortBy.LastUpdatedOn,
							order: GraphqlSortOrder.Desc,
						},
					},
				},
			);
			const images = [];
			for (const content of collectionContents.results.items) {
				if (images.length === 5) break;
				if (content.entityLot !== EntityLot.Metadata) continue;
				const { image } = await queryClient.ensureQueryData(
					getPartialMetadataDetailsQuery(content.entityId),
				);
				if (isString(image)) images.push(image);
			}
			return images;
		},
		staleTime: dayjsLib.duration(1, "hour").asMilliseconds(),
	});

	const [hoveredStates, setHoveredStates] = useListState<boolean>([]);

	const setHoveredState = (index: number, state: boolean) => {
		setHoveredStates.setItem(index, state);
	};

	const currentlyHovered = hoveredStates.findIndex((h) => h);

	if (props.collection.creator.id !== userDetails.id)
		additionalDisplay.push(`By ${props.collection.creator.name}`);
	if (props.collection.count > 0)
		additionalDisplay.push(`${props.collection.count} items`);
	if (props.collection.collaborators.length > 0)
		additionalDisplay.push(
			`${props.collection.collaborators.length} collaborators`,
		);

	const FallBackImage = () => (
		<Image src={fallbackImageUrl} h="100%" flex="none" mx="auto" radius="md" />
	);

	return (
		<Paper
			pr="md"
			radius="lg"
			withBorder
			mt={props.index !== 0 ? "lg" : undefined}
			pl={{ base: "md", md: 0 }}
			py={{ base: "sm", md: 0 }}
			style={{ overflow: "hidden" }}
		>
			<Flex gap="xs" direction={{ base: "column", md: "row" }}>
				<Flex
					h={180}
					w={{ md: IMAGES_CONTAINER_WIDTH }}
					pos="relative"
					style={{ overflow: "hidden" }}
				>
					{coreDetails.isPro ? (
						collectionImages && collectionImages.length > 0 ? (
							collectionImages.map((image, index) => {
								const shouldCollapse = index < currentlyHovered;
								return (
									<CollectionImageDisplay
										key={image}
										image={image}
										index={index}
										shouldCollapse={shouldCollapse}
										setHoveredState={setHoveredState}
										totalImages={collectionImages.length}
									/>
								);
							})
						) : (
							<FallBackImage />
						)
					) : (
						<>
							<FallBackImage />
							<Box pos="absolute" left={0} right={0} bottom={0}>
								<ProRequiredAlert tooltipLabel="Collage image using collection contents" />
							</Box>
						</>
					)}
				</Flex>
				<Stack flex={1} py={{ md: "sm" }}>
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
											collaborators: props.collection.collaborators,
											isDefault: props.collection.isDefault,
											informationTemplate: props.collection.informationTemplate,
										});
										props.openModal();
									}}
								>
									<IconEdit size={18} />
								</ActionIcon>
							) : null}
							{!props.collection.isDefault ? (
								<Form
									method="POST"
									action={withQuery("", { intent: "delete" })}
								>
									<input
										hidden
										name="collectionName"
										defaultValue={props.collection.name}
									/>
									<ActionIcon
										type="submit"
										color="red"
										variant="outline"
										onClick={async (e) => {
											const form = e.currentTarget.form;
											e.preventDefault();
											const conf = await confirmWrapper({
												confirmation:
													"Are you sure you want to delete this collection?",
											});
											if (conf && form) submit(form);
										}}
									>
										<IconTrashFilled size={18} />
									</ActionIcon>
								</Form>
							) : null}
						</Group>
					</Group>
					{props.collection.description ? (
						<Text size="xs" lineClamp={5}>
							{props.collection.description}
						</Text>
					) : null}
					{props.collection.isDefault ? (
						<Text lineClamp={1} mt="auto" ta="right" c="dimmed" size="xs">
							System created
						</Text>
					) : null}
				</Stack>
			</Flex>
		</Paper>
	);
};

const CollectionImageDisplay = (props: {
	image: string;
	index: number;
	totalImages: number;
	shouldCollapse: boolean;
	setHoveredState: (index: number, state: boolean) => void;
}) => {
	const { ref, hovered } = useHover();
	const offset = IMAGES_CONTAINER_WIDTH / props.totalImages - 20;

	useDidUpdate(() => {
		props.setHoveredState(props.index, hovered);
	}, [hovered]);

	return (
		<Box
			h="100%"
			w="120px"
			ref={ref}
			top={{ md: 0 }}
			pos={{ md: "absolute" }}
			left={{
				md: props.index * offset - (props.shouldCollapse ? offset * 2 : 0),
			}}
			style={{
				zIndex: props.totalImages - props.index,
				transitionProperty: "left",
				transitionDuration: "0.2s",
				transitionTimingFunction: "ease-in-out",
			}}
		>
			<Image src={props.image} h="100%" />
		</Box>
	);
};

const CreateOrUpdateModal = (props: {
	toUpdateCollection: UpdateCollectionInput | undefined;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const userDetails = useUserDetails();
	const [parent] = useAutoAnimate();
	const [informationTemplate, setInformationTemplate] =
		useListState<CollectionExtraInformation>(
			props.toUpdateCollection?.informationTemplate || [],
		);

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
					description={
						props.toUpdateCollection?.isDefault
							? "Can not edit a default collection"
							: undefined
					}
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
				<Tooltip
					label="Ryot pro required to use this feature"
					disabled={coreDetails.isPro}
				>
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
							disabled: u.id === userDetails.id,
						}))}
						disabled={!coreDetails.isPro}
					/>
				</Tooltip>
				<Input.Wrapper
					labelProps={{ w: "100%" }}
					label={
						<Group wrap="nowrap" justify="space-between">
							<Input.Label size="xs">Information template</Input.Label>
							<Anchor
								size="xs"
								onClick={() => {
									if (!coreDetails.isPro) {
										notifications.show({
											color: "red",
											message: "Ryot pro is required to use this feature",
										});
										return;
									}
									setInformationTemplate.append({
										name: "",
										description: "",
										lot: CollectionExtraInformationLot.String,
									});
								}}
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
										flex={1}
										name={`informationTemplate[${index}].lot`}
										data={Object.values(CollectionExtraInformationLot).map(
											(lot) => ({ value: lot, label: changeCase(lot) }),
										)}
										size="xs"
										defaultValue={field.lot}
									/>
									<TextInput
										label="Default value"
										flex={1}
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
