import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	Anchor,
	Button,
	Checkbox,
	Group,
	Input,
	MultiSelect,
	Paper,
	Select,
	Stack,
	TagsInput,
	TextInput,
	Textarea,
	Title,
	Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	type CollectionExtraInformation,
	CollectionExtraInformationLot,
	CreateOrUpdateCollectionDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconTrash } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { produce } from "immer";
import { useState } from "react";
import { Form } from "react-router";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useCoreDetails,
	useFormValidation,
	useUserCollections,
	useUserDetails,
	useUsersList,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { useCreateOrUpdateCollectionModal } from "~/lib/state/collection";

export const CreateOrUpdateCollectionModal = (props: {
	onClose: () => void;
}) => {
	const coreDetails = useCoreDetails();
	const userDetails = useUserDetails();
	const userCollections = useUserCollections();
	const [parent] = useAutoAnimate();

	const { data: modalData } = useCreateOrUpdateCollectionModal();

	const toUpdateCollection = modalData?.collectionId
		? userCollections.find((c) => c.id === modalData.collectionId)
		: null;

	const [formData, setFormData] = useState<{
		name: string;
		isHidden: boolean;
		description: string;
		collaborators: string[];
		informationTemplate: CollectionExtraInformation[];
	}>({
		name: toUpdateCollection?.name || "",
		description: toUpdateCollection?.description || "",
		informationTemplate: toUpdateCollection?.informationTemplate || [],
		collaborators: (toUpdateCollection?.collaborators || []).map(
			(c) => c.collaborator.id,
		),
		isHidden: Boolean(
			toUpdateCollection?.collaborators?.find(
				(c) => c.collaborator.id === userDetails.id,
			)?.extraInformation?.isHidden,
		),
	});

	const { formRef, isFormValid } = useFormValidation(formData);

	const { data: usersList } = useUsersList();
	const createOrUpdateMutation = useMutation({
		mutationFn: () =>
			clientGqlService.request(CreateOrUpdateCollectionDocument, {
				input: {
					name: formData.name,
					updateId: toUpdateCollection?.id,
					description: formData.description,
					collaborators: formData.collaborators,
					extraInformation: { isHidden: formData.isHidden },
					informationTemplate:
						formData.informationTemplate.length > 0
							? formData.informationTemplate
							: undefined,
				},
			}),
		onSuccess: () => {
			notifications.show({
				color: "green",
				message: toUpdateCollection?.id
					? "Collection updated"
					: "Collection created",
			});
			queryClient.invalidateQueries({
				queryKey: queryFactory.collections.userCollectionsList().queryKey,
			});
			props.onClose();
		},
		onError: (_error) =>
			notifications.show({ color: "red", message: "An error occurred" }),
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
					{toUpdateCollection?.id ? "Update" : "Create"} collection
				</Title>
				<TextInput
					required
					label="Name"
					value={formData.name}
					readOnly={toUpdateCollection?.isDefault}
					description={
						toUpdateCollection?.isDefault
							? "Can not edit a default collection"
							: undefined
					}
					onChange={(e) => {
						setFormData(
							produce(formData, (draft) => {
								draft.name = e.target.value;
							}),
						);
					}}
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
						checked={formData.isHidden}
						disabled={!coreDetails.isServerKeyValidated}
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
						value={formData.collaborators}
						disabled={!coreDetails.isServerKeyValidated}
						description="Add collaborators to this collection"
						data={usersList?.map((u) => ({
							value: u.id,
							label: u.name,
							disabled: u.id === userDetails.id,
						}))}
						onChange={(value) =>
							setFormData(
								produce(formData, (draft) => {
									draft.collaborators = value;
								}),
							)
						}
					/>
				</Tooltip>
				<Input.Wrapper
					labelProps={{ w: "100%" }}
					description="Associate extra information when adding an entity to this collection"
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
					{toUpdateCollection?.id ? "Update" : "Create"}
				</Button>
			</Stack>
		</Form>
	);
};
