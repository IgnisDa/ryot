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
	TagsInput,
	Text,
	TextInput,
	Textarea,
	Title,
	Tooltip,
} from "@mantine/core";
import { useDidUpdate, useHover, useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
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
	type UsersListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { getActionIntent, processSubmission, truncate } from "@ryot/ts-utils";
import {
	IconEdit,
	IconPlus,
	IconTrash,
	IconTrashFilled,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { useState } from "react";
import { Form, Link, useLoaderData, useRevalidator } from "react-router";
import { Virtuoso } from "react-virtuoso";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { DebouncedSearchInput, ProRequiredAlert } from "~/components/common";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useAppSearchParam,
	useConfirmSubmit,
	useCoreDetails,
	useFallbackImageUrl,
	useFormValidation,
	useUserCollections,
	useUserDetails,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	getMetadataDetailsQuery,
	queryClient,
	queryFactory,
} from "~/lib/shared/query-factory";
import {
	convertEnumToSelectData,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import {
	createToastHeaders,
	getSearchEnhancedCookieName,
	getUserCollectionsListRaw,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.collections.list";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const cookieName = await getSearchEnhancedCookieName(
		"collections.list",
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const [{ usersList }, userCollectionsList] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UsersListDocument, {}),
		getUserCollectionsListRaw(request),
	]);
	return { usersList, cookieName, userCollectionsList };
};

export const meta = () => {
	return [{ title: "Your collections | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
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

type UpdateCollectionInput = {
	id?: string;
	name?: string;
	isDefault?: boolean;
	description?: string;
	collaborators?: Collection["collaborators"];
	informationTemplate?: CollectionExtraInformation[] | null;
};

export default function Page() {
	const userDetails = useUserDetails();
	const collections = useUserCollections();
	const loaderData = useLoaderData<typeof loader>();
	const [toUpdateCollection, setToUpdateCollection] =
		useState<UpdateCollectionInput | null>(null);
	const [params, { setP }] = useAppSearchParam(loaderData.cookieName);

	const query = params.get("query") || undefined;
	const showHidden = Boolean(params.get("showHidden"));
	const hasHiddenCollections = collections.some(
		(c) =>
			c.collaborators.find((c) => c.collaborator.id === userDetails.id)
				?.extraInformation?.isHidden,
	);

	const filteredCollections = collections
		.filter((c) =>
			showHidden
				? true
				: c.collaborators.find((c) => c.collaborator.id === userDetails.id)
						?.extraInformation?.isHidden !== true,
		)
		.filter((c) =>
			query ? c.name.toLowerCase().includes(query.toLowerCase()) : true,
		);

	return (
		<Container size="sm">
			<Stack>
				<Group justify="space-between" wrap="nowrap">
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
							<CreateOrUpdateModal
								usersList={loaderData.usersList}
								toUpdateCollection={toUpdateCollection}
								onClose={() => setToUpdateCollection(null)}
							/>
						</Modal>
					</Flex>
				</Group>
				<DebouncedSearchInput
					initialValue={query}
					enhancedQueryParams={loaderData.cookieName}
				/>
				<Group justify="space-between" align="center">
					<Box>
						<Text display="inline" fw="bold">
							{collections.length}
						</Text>{" "}
						items found
					</Box>
					{hasHiddenCollections ? (
						<Checkbox
							size="sm"
							name="showHidden"
							label="Show hidden"
							defaultChecked={showHidden}
							onChange={(e) =>
								setP("showHidden", e.target.checked ? "yes" : "")
							}
						/>
					) : null}
				</Group>
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

type Collection =
	UserCollectionsListQuery["userCollectionsList"]["response"][number];

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
						search: { take: 10 },
						collectionId: props.collection.id,
						sort: {
							order: GraphqlSortOrder.Desc,
							by: CollectionContentsSortBy.LastUpdatedOn,
						},
					},
				},
			);
			const images = [];
			for (const content of collectionContents.response.results.items) {
				if (images.length === 5) break;
				if (content.entityLot !== EntityLot.Metadata) continue;
				const { assets } = await queryClient.ensureQueryData(
					getMetadataDetailsQuery(content.entityId),
				);
				if (assets.remoteImages.length > 0) images.push(assets.remoteImages[0]);
			}
			return images;
		},
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
	if (props.collection.collaborators.length > 1)
		additionalDisplay.push(
			`${props.collection.collaborators.length - 1} collaborators`,
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
							{props.collection.collaborators.find(
								(c) => c.collaborator.id === userDetails.id,
							)?.extraInformation?.isHidden
								? ", Hidden"
								: ""}
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
	onClose: () => void;
	usersList: UsersListQuery["usersList"];
	toUpdateCollection: UpdateCollectionInput | null;
}) => {
	const coreDetails = useCoreDetails();
	const userDetails = useUserDetails();
	const revalidator = useRevalidator();
	const [parent] = useAutoAnimate();
	const [formData, setFormData] = useState({
		name: props.toUpdateCollection?.name || "",
		description: props.toUpdateCollection?.description || "",
		informationTemplate: props.toUpdateCollection?.informationTemplate || [],
		collaborators: (props.toUpdateCollection?.collaborators || []).map(
			(c) => c.collaborator.id,
		),
		isHidden: Boolean(
			props.toUpdateCollection?.collaborators?.find(
				(c) => c.collaborator.id === userDetails.id,
			)?.extraInformation?.isHidden,
		),
	});

	const { formRef, isFormValid } = useFormValidation(formData);

	const createOrUpdateMutation = useMutation({
		mutationFn: async () => {
			const input = {
				name: formData.name,
				description: formData.description,
				collaborators: formData.collaborators,
				updateId: props.toUpdateCollection?.id,
				extraInformation: { isHidden: formData.isHidden },
				informationTemplate:
					formData.informationTemplate.length > 0
						? formData.informationTemplate
						: undefined,
			};
			return clientGqlService.request(CreateOrUpdateCollectionDocument, {
				input,
			});
		},
		onSuccess: () => {
			notifications.show({
				color: "green",
				message: props.toUpdateCollection?.id
					? "Collection updated"
					: "Collection created",
			});
			revalidator.revalidate();
			props.onClose();
		},
		onError: (_error) => {
			notifications.show({
				color: "red",
				message: "An error occurred",
			});
		},
	});

	return (
		<Form
			ref={formRef}
			onSubmit={(e) => {
				e.preventDefault();
				createOrUpdateMutation.mutate();
			}}
		>
			<Stack>
				<Title order={3}>
					{props.toUpdateCollection?.id ? "Update" : "Create"} collection
				</Title>
				<TextInput
					required
					label="Name"
					value={formData.name}
					onChange={(e) => {
						setFormData(
							produce(formData, (draft) => {
								draft.name = e.target.value;
							}),
						);
					}}
					readOnly={props.toUpdateCollection?.isDefault}
					description={
						props.toUpdateCollection?.isDefault
							? "Can not edit a default collection"
							: undefined
					}
				/>
				<Textarea
					autosize
					label="Description"
					value={formData.description}
					onChange={(e) =>
						setFormData(
							produce(formData, (draft) => {
								draft.description = e.target.value;
							}),
						)
					}
				/>
				<Tooltip
					label={PRO_REQUIRED_MESSAGE}
					disabled={coreDetails.isServerKeyValidated}
				>
					<Checkbox
						label="Hide collection"
						disabled={!coreDetails.isServerKeyValidated}
						checked={formData.isHidden}
						onChange={(e) =>
							setFormData(
								produce(formData, (draft) => {
									draft.isHidden = e.target.checked;
								}),
							)
						}
					/>
				</Tooltip>
				<Tooltip
					label={PRO_REQUIRED_MESSAGE}
					disabled={coreDetails.isServerKeyValidated}
				>
					<MultiSelect
						searchable
						disabled={!coreDetails.isServerKeyValidated}
						description="Add collaborators to this collection"
						value={formData.collaborators}
						onChange={(value) =>
							setFormData(
								produce(formData, (draft) => {
									draft.collaborators = value;
								}),
							)
						}
						data={props.usersList.map((u) => ({
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
									setFormData(
										produce(formData, (draft) => {
											draft.informationTemplate.push({
												name: "",
												description: "",
												lot: CollectionExtraInformationLot.String,
											});
										}),
									);
								}}
							>
								Add field
							</Anchor>
						</Group>
					}
					description="Associate extra information when adding an entity to this collection"
				>
					<Stack gap="xs" mt="xs" ref={parent}>
						{formData.informationTemplate.map((field, index) => (
							<Paper withBorder key={index.toString()} p="xs">
								<TextInput
									required
									size="xs"
									label="Name"
									value={field.name}
									onChange={(e) => {
										setFormData(
											produce(formData, (draft) => {
												draft.informationTemplate[index] = {
													...field,
													name: e.target.value,
												};
											}),
										);
									}}
								/>
								<Textarea
									required
									size="xs"
									label="Description"
									value={field.description}
									onChange={(e) => {
										setFormData(
											produce(formData, (draft) => {
												draft.informationTemplate[index] = {
													...field,
													description: e.target.value,
												};
											}),
										);
									}}
								/>
								<Group wrap="nowrap">
									<Select
										flex={1}
										required
										size="xs"
										label="Input type"
										value={field.lot}
										data={convertEnumToSelectData(
											CollectionExtraInformationLot,
										)}
										onChange={(v) => {
											setFormData(
												produce(formData, (draft) => {
													draft.informationTemplate[index] = {
														...field,
														lot: v as CollectionExtraInformationLot,
													};
												}),
											);
										}}
									/>
									{field.lot !== CollectionExtraInformationLot.StringArray ? (
										<TextInput
											flex={1}
											size="xs"
											label="Default value"
											value={field.defaultValue || ""}
											onChange={(e) => {
												setFormData(
													produce(formData, (draft) => {
														draft.informationTemplate[index] = {
															...field,
															defaultValue: e.target.value,
														};
													}),
												);
											}}
										/>
									) : null}
								</Group>
								{field.lot === CollectionExtraInformationLot.StringArray ? (
									<TagsInput
										size="xs"
										label="Possible values"
										value={field.possibleValues || []}
										onChange={(value) => {
											setFormData(
												produce(formData, (draft) => {
													draft.informationTemplate[index] = {
														...field,
														possibleValues: value,
													};
												}),
											);
										}}
									/>
								) : null}
								<Group mt="xs" justify="space-around">
									<Checkbox
										size="sm"
										label="Required"
										checked={field.required || false}
										onChange={(e) => {
											setFormData(
												produce(formData, (draft) => {
													draft.informationTemplate[index] = {
														...field,
														required: e.target.checked,
													};
												}),
											);
										}}
									/>
									<Button
										size="xs"
										color="red"
										variant="subtle"
										leftSection={<IconTrash />}
										onClick={() => {
											setFormData(
												produce(formData, (draft) => {
													draft.informationTemplate.splice(index, 1);
												}),
											);
										}}
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
					disabled={!isFormValid}
					loading={createOrUpdateMutation.isPending}
				>
					{props.toUpdateCollection?.id ? "Update" : "Create"}
				</Button>
			</Stack>
		</Form>
	);
};
