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
import { useDidUpdate, useHover, useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaArgs,
} from "@remix-run/node";
import {
	Form,
	Link,
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
	getActionIntent,
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
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput, ProRequiredAlert } from "~/components/common";
import {
	PRO_REQUIRED_MESSAGE,
	clientGqlService,
	commaDelimitedString,
	dayjsLib,
	getPartialMetadataDetailsQuery,
	openConfirmationModal,
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
	serverGqlService,
} from "~/lib/utilities.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const cookieName = await getEnhancedCookieName("collections.list", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const [{ usersList }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UsersListDocument, {}),
	]);
	return { usersList, cookieName };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Your collections | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("createOrUpdate", async () => {
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
				return Response.json(
					{ error: JSON.stringify(e) },
					{
						status: 400,
						headers: await createToastHeaders({ type: "error", message }),
					},
				);
			}
		})
		.with("delete", async () => {
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
		})
		.run();
};

const createOrUpdateSchema = z.object({
	name: z.string(),
	updateId: z.string().optional(),
	description: z.string().optional(),
	collaborators: commaDelimitedString,
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
	id?: string;
	name?: string;
	isDefault?: boolean;
	description?: string;
	collaborators?: Collection["collaborators"];
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
		useState<UpdateCollectionInput | null>(null);
	useEffect(() => {
		if (transition.state !== "submitting") {
			setToUpdateCollection(null);
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
						onClick={() => setToUpdateCollection({})}
					>
						<IconPlus size={20} />
					</ActionIcon>
					<Modal
						centered
						size="lg"
						withCloseButton={false}
						opened={toUpdateCollection !== null}
						onClose={() => setToUpdateCollection(null)}
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
	index: number;
	collection: Collection;
	setToUpdateCollection: (c: UpdateCollectionInput) => void;
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
			pl={{ base: "md", md: 0 }}
			py={{ base: "sm", md: 0 }}
			style={{ overflow: "hidden" }}
			mt={props.index !== 0 ? "lg" : undefined}
		>
			<Flex gap="xs" direction={{ base: "column", md: "row" }}>
				<Flex
					h={180}
					w={{ md: IMAGES_CONTAINER_WIDTH }}
					pos="relative"
					style={{ overflow: "hidden" }}
				>
					{coreDetails.isServerKeyValidated ? (
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
											id: props.collection.id,
											name: props.collection.name,
											isDefault: props.collection.isDefault,
											collaborators: props.collection.collaborators,
											description: props.collection.description ?? undefined,
											informationTemplate: props.collection.informationTemplate,
										});
									}}
								>
									<IconEdit size={18} />
								</ActionIcon>
							) : null}
							{!props.collection.isDefault ? (
								<Form
									method="POST"
									action={withQuery(".", { intent: "delete" })}
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
										onClick={(e) => {
											const form = e.currentTarget.form;
											e.preventDefault();
											openConfirmationModal(
												"Are you sure you want to delete this collection?",
												() => submit(form),
											);
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
	toUpdateCollection: UpdateCollectionInput | null;
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
			action={withQuery(".", { intent: "createOrUpdate" })}
		>
			<Stack>
				<Title order={3}>
					{props.toUpdateCollection ? "Update" : "Create"} collection
				</Title>
				<TextInput
					label="Name"
					required
					name="name"
					defaultValue={props.toUpdateCollection?.name}
					readOnly={props.toUpdateCollection?.isDefault}
					description={
						props.toUpdateCollection?.isDefault
							? "Can not edit a default collection"
							: undefined
					}
				/>
				<Textarea
					autosize
					name="description"
					label="Description"
					defaultValue={props.toUpdateCollection?.description}
				/>
				<Tooltip
					label={PRO_REQUIRED_MESSAGE}
					disabled={coreDetails.isServerKeyValidated}
				>
					<MultiSelect
						searchable
						name="collaborators"
						disabled={!coreDetails.isServerKeyValidated}
						description="Add collaborators to this collection"
						defaultValue={(props.toUpdateCollection?.collaborators || []).map(
							(c) => c.id,
						)}
						data={loaderData.usersList.map((u) => ({
							value: u.id,
							label: u.name,
							disabled: u.id === userDetails.id,
						}))}
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
									if (!coreDetails.isServerKeyValidated) {
										notifications.show({
											color: "red",
											message: PRO_REQUIRED_MESSAGE,
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
										size="sm"
										label="Required"
										name={`informationTemplate[${index}].required`}
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
					type="submit"
					variant="outline"
					value={props.toUpdateCollection?.id}
					name={props.toUpdateCollection ? "updateId" : undefined}
				>
					{props.toUpdateCollection ? "Update" : "Create"}
				</Button>
			</Stack>
		</Box>
	);
};
