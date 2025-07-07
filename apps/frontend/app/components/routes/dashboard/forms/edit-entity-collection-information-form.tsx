import {
	Button,
	NumberInput,
	Stack,
	Switch,
	Text,
	TextInput,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import {
	CollectionExtraInformationLot,
	type Scalars,
} from "@ryot/generated/graphql/backend/graphql";
import { type FormEvent, useState } from "react";
import { Form } from "react-router";
import { Fragment } from "react/jsx-runtime";
import { match } from "ts-pattern";
import { MultiSelectCreatable } from "~/components/common";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useAddEntitiesToCollectionMutation,
	useApplicationEvents,
	useFormValidation,
	useUserCollections,
} from "~/lib/shared/hooks";
import { refreshEntityDetails } from "~/lib/shared/query-factory";
import { useEditEntityCollectionInformation } from "~/lib/state/collection";

export const EditEntityCollectionInformationForm = ({
	closeEditEntityCollectionInformationModal,
}: {
	closeEditEntityCollectionInformationModal: () => void;
}) => {
	const userCollections = useUserCollections();
	const events = useApplicationEvents();
	const [editEntityCollectionInformationData] =
		useEditEntityCollectionInformation();
	const addEntitiesToCollection = useAddEntitiesToCollectionMutation();

	const [userExtraInformationData, setUserExtraInformationData] = useState<
		Scalars["JSON"]["input"]
	>(editEntityCollectionInformationData?.existingInformation || {});

	const { formRef, isFormValid } = useFormValidation([
		userExtraInformationData,
	]);

	if (!editEntityCollectionInformationData) return null;

	const thisCollection = userCollections.find(
		(c) => c.id === editEntityCollectionInformationData.collectionId,
	);

	const handleCustomFieldChange = (field: string, value: unknown) => {
		setUserExtraInformationData((prev: Scalars["JSON"]["input"]) => ({
			...prev,
			[field]: value,
		}));
	};

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!editEntityCollectionInformationData) return;

		await addEntitiesToCollection.mutateAsync({
			collectionName: editEntityCollectionInformationData.collectionName,
			creatorUserId: editEntityCollectionInformationData.creatorUserId,
			entities: [
				{
					information: userExtraInformationData,
					entityId: editEntityCollectionInformationData.entityId,
					entityLot: editEntityCollectionInformationData.entityLot,
				},
			],
		});
		notifications.show({
			color: "green",
			title: "Updated collection information",
			message: "Entity collection information updated successfully",
		});
		refreshEntityDetails(editEntityCollectionInformationData.entityId);
		closeEditEntityCollectionInformationModal();
		events.addToCollection(editEntityCollectionInformationData.entityLot);
	};

	return (
		<Form ref={formRef} onSubmit={handleSubmit}>
			<Stack>
				<Text>
					Editing information for:{" "}
					{editEntityCollectionInformationData.collectionName}
				</Text>
				{thisCollection?.informationTemplate?.map((template) => (
					<Fragment key={template.name}>
						{match(template.lot)
							.with(CollectionExtraInformationLot.String, () => (
								<TextInput
									label={template.name}
									required={!!template.required}
									description={template.description}
									value={userExtraInformationData[template.name] || ""}
									onChange={(e) =>
										handleCustomFieldChange(
											template.name,
											e.currentTarget.value,
										)
									}
								/>
							))
							.with(CollectionExtraInformationLot.Boolean, () => (
								<Switch
									label={template.name}
									required={!!template.required}
									description={template.description}
									checked={userExtraInformationData[template.name] === "true"}
									onChange={(e) =>
										handleCustomFieldChange(
											template.name,
											e.currentTarget.checked ? "true" : "false",
										)
									}
								/>
							))
							.with(CollectionExtraInformationLot.Number, () => (
								<NumberInput
									label={template.name}
									required={!!template.required}
									description={template.description}
									value={userExtraInformationData[template.name]}
									onChange={(v) => handleCustomFieldChange(template.name, v)}
								/>
							))
							.with(CollectionExtraInformationLot.Date, () => (
								<DateInput
									label={template.name}
									required={!!template.required}
									description={template.description}
									value={userExtraInformationData[template.name]}
									onChange={(v) => handleCustomFieldChange(template.name, v)}
								/>
							))
							.with(CollectionExtraInformationLot.DateTime, () => (
								<DateTimePicker
									label={template.name}
									required={!!template.required}
									description={template.description}
									value={userExtraInformationData[template.name]}
									onChange={(v) =>
										handleCustomFieldChange(
											template.name,
											dayjsLib(v).toISOString(),
										)
									}
								/>
							))
							.with(CollectionExtraInformationLot.StringArray, () => (
								<MultiSelectCreatable
									label={template.name}
									required={!!template.required}
									description={template.description}
									data={template.possibleValues || []}
									values={userExtraInformationData[template.name]}
									setValue={(newValue) =>
										handleCustomFieldChange(template.name, newValue)
									}
								/>
							))
							.exhaustive()}
					</Fragment>
				))}
				<Button
					type="submit"
					variant="outline"
					disabled={!isFormValid}
					loading={addEntitiesToCollection.isPending}
				>
					Update
				</Button>
			</Stack>
		</Form>
	);
};
