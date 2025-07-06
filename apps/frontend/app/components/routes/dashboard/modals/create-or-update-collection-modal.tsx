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
	CollectionExtraInformationLot,
	CreateOrUpdateCollectionDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconTrash } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { produce } from "immer";
import { useState } from "react";
import { Form, useRevalidator } from "react-router";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useCoreDetails,
	useFormValidation,
	useUserDetails,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/query-factory";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { useCreateOrUpdateCollectionModal } from "~/lib/state/collection";

export const CreateOrUpdateCollectionModal = (props: {
	onClose: () => void;
}) => {
	const coreDetails = useCoreDetails();
	const userDetails = useUserDetails();
	const revalidator = useRevalidator();
	const [parent] = useAutoAnimate();
	const { data: toUpdateCollection, usersList } =
		useCreateOrUpdateCollectionModal();

	const [formData, setFormData] = useState({
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

	const createOrUpdateMutation = useMutation({
		mutationFn: async () => {
			const input = {
				name: formData.name,
				description: formData.description,
				collaborators: formData.collaborators,
				updateId: toUpdateCollection?.id,
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
				message: toUpdateCollection?.id
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
					{toUpdateCollection?.id ? "Update" : "Create"} collection
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
					readOnly={toUpdateCollection?.isDefault}
					description={
						toUpdateCollection?.isDefault
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
						data={usersList.map((u) => ({
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
					{toUpdateCollection?.id ? "Update" : "Create"}
				</Button>
			</Stack>
		</Form>
	);
};
