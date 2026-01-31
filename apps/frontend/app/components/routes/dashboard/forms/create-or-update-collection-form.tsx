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
	Textarea,
	TextInput,
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
import { useSavedForm } from "~/lib/hooks/use-saved-form";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useCoreDetails,
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
	const [parent] = useAutoAnimate();
	const coreDetails = useCoreDetails();
	const userDetails = useUserDetails();
	const userCollections = useUserCollections();

	const { data: modalData } = useCreateOrUpdateCollectionModal();

	const toUpdateCollection = modalData?.collectionId
		? userCollections.find((c) => c.id === modalData.collectionId)
		: null;

	const form = useSavedForm<{
		name: string;
		isHidden: boolean;
		description: string;
		collaborators: string[];
		informationTemplate: CollectionExtraInformation[];
	}>({
		storageKeyPrefix: "CreateOrUpdateCollectionForm",
		initialValues: {
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
		},
		validate: {
			name: (value) => (value.trim() ? null : "Name is required"),
		},
	});

	const updateTemplateField = (
		index: number,
		updates: Partial<CollectionExtraInformation>,
	) => {
		const newTemplate = [...form.values.informationTemplate];
		newTemplate[index] = { ...newTemplate[index], ...updates };
		form.setFieldValue("informationTemplate", newTemplate);
	};

	const { data: usersList } = useUsersList();
	const createOrUpdateMutation = useMutation({
		mutationFn: (values: typeof form.values) =>
			clientGqlService.request(CreateOrUpdateCollectionDocument, {
				input: {
					name: values.name,
					updateId: toUpdateCollection?.id,
					description: values.description,
					collaborators: values.collaborators,
					extraInformation: { isHidden: values.isHidden },
					informationTemplate:
						values.informationTemplate.length > 0
							? values.informationTemplate
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
			form.clearSavedState();
			props.onClose();
		},
		onError: (_error) =>
			notifications.show({ color: "red", message: "An error occurred" }),
	});

	return (
		<form
			onSubmit={form.onSubmit((values) => {
				createOrUpdateMutation.mutate(values);
			})}
		>
			<Stack>
				<Title order={3}>
					{toUpdateCollection?.id ? "Update" : "Create"} collection
				</Title>
				<TextInput
					required
					label="Name"
					readOnly={toUpdateCollection?.isDefault}
					description={
						toUpdateCollection?.isDefault
							? "Can not edit a default collection"
							: undefined
					}
					{...form.getInputProps("name")}
				/>
				<Textarea
					autosize
					label="Description"
					{...form.getInputProps("description")}
				/>
				<Tooltip
					label={PRO_REQUIRED_MESSAGE}
					disabled={coreDetails.isServerKeyValidated}
				>
					<Checkbox
						label="Hide collection"
						disabled={!coreDetails.isServerKeyValidated}
						{...form.getInputProps("isHidden", { type: "checkbox" })}
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
						data={usersList?.map((u) => ({
							value: u.id,
							label: u.name,
							disabled: u.id === userDetails.id,
						}))}
						{...form.getInputProps("collaborators")}
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
									form.setFieldValue("informationTemplate", [
										...form.values.informationTemplate,
										{
											name: "",
											description: "",
											lot: CollectionExtraInformationLot.String,
										},
									]);
								}}
							>
								Add field
							</Anchor>
						</Group>
					}
				>
					<Stack gap="xs" mt="xs" ref={parent}>
						{form.values.informationTemplate.map((field, index) => (
							<Paper withBorder key={index.toString()} p="xs">
								<TextInput
									required
									size="xs"
									label="Name"
									value={field.name}
									onChange={(e) =>
										updateTemplateField(index, { name: e.target.value })
									}
								/>
								<Textarea
									required
									size="xs"
									label="Description"
									value={field.description}
									onChange={(e) =>
										updateTemplateField(index, { description: e.target.value })
									}
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
										onChange={(v) =>
											updateTemplateField(index, {
												lot: v as CollectionExtraInformationLot,
											})
										}
									/>
									{field.lot !== CollectionExtraInformationLot.StringArray ? (
										<TextInput
											flex={1}
											size="xs"
											label="Default value"
											value={field.defaultValue || ""}
											onChange={(e) =>
												updateTemplateField(index, {
													defaultValue: e.target.value,
												})
											}
										/>
									) : null}
								</Group>
								{field.lot === CollectionExtraInformationLot.StringArray ? (
									<TagsInput
										size="xs"
										label="Possible values"
										value={field.possibleValues || []}
										onChange={(value) =>
											updateTemplateField(index, { possibleValues: value })
										}
									/>
								) : null}
								<Group mt="xs" justify="space-around">
									<Checkbox
										size="sm"
										label="Required"
										checked={field.required || false}
										onChange={(e) =>
											updateTemplateField(index, { required: e.target.checked })
										}
									/>
									<Button
										size="xs"
										color="red"
										variant="subtle"
										leftSection={<IconTrash />}
										onClick={() => {
											const newTemplate = [...form.values.informationTemplate];
											newTemplate.splice(index, 1);
											form.setFieldValue("informationTemplate", newTemplate);
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
					loading={createOrUpdateMutation.isPending}
				>
					{toUpdateCollection?.id ? "Update" : "Create"}
				</Button>
			</Stack>
		</form>
	);
};
