import { Button, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { Scalars } from "@ryot/generated/graphql/backend/graphql";
import { type FormEvent, useState } from "react";
import { Form } from "react-router";
import { CollectionTemplateRenderer } from "~/components/common/collection-template-renderer";
import {
	useAddEntitiesToCollectionMutation,
	useApplicationEvents,
	useFormValidation,
	useUserCollections,
} from "~/lib/shared/hooks";
import { refreshEntityDetails } from "~/lib/shared/react-query";
import { useEditEntityCollectionInformation } from "~/lib/state/collection";

export const EditEntityCollectionInformationForm = (props: {
	closeEditEntityCollectionInformationModal: () => void;
}) => {
	const events = useApplicationEvents();
	const userCollections = useUserCollections();
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
		props.closeEditEntityCollectionInformationModal();
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
					<CollectionTemplateRenderer
						key={template.name}
						template={template}
						value={userExtraInformationData[template.name]}
						onChange={(value) => handleCustomFieldChange(template.name, value)}
					/>
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
