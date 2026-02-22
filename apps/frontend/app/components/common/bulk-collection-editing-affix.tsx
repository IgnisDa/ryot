import {
	ActionIcon,
	Affix,
	Button,
	Group,
	Modal,
	Paper,
	rem,
	Stack,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type {
	EntityToCollectionInput,
	Scalars,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconCancel } from "@tabler/icons-react";
import { type FormEvent, useState } from "react";
import {
	useAddEntitiesToCollectionMutation,
	useFormValidation,
	useRemoveEntitiesFromCollectionMutation,
	useUserCollections,
} from "~/lib/shared/hooks";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import {
	type BulkEditEntitiesToCollection,
	useBulkEditCollection,
} from "~/lib/state/collection";
import { CollectionTemplateRenderer } from "./collection-template-renderer";

export interface BulkCollectionEditingAffixProps {
	bulkAddEntities: BulkEditEntitiesToCollection;
}

export const BulkCollectionEditingAffix = (
	props: BulkCollectionEditingAffixProps,
) => {
	const userCollections = useUserCollections();
	const bulkEditingCollection = useBulkEditCollection();
	const addEntitiesToCollection = useAddEntitiesToCollectionMutation();
	const removeEntitiesFromCollection =
		useRemoveEntitiesFromCollectionMutation();
	const [bulkExtraInformation, setBulkExtraInformation] = useState<
		Record<string, unknown>
	>({});
	const { formRef, isFormValid } = useFormValidation([bulkExtraInformation]);
	const [
		extraInformationModalOpened,
		{ open: openExtraInformationModal, close: closeExtraInformationModal },
	] = useDisclosure(false);

	const bulkEditingCollectionState = bulkEditingCollection.state;

	if (!bulkEditingCollectionState) return null;

	const { action, collection, targetEntities } =
		bulkEditingCollectionState.data;
	const isRemoving = action === "remove";
	const collectionDetails = userCollections.find((c) => c.id === collection.id);
	const requiresExtraInformation =
		!isRemoving && !!collectionDetails?.informationTemplate?.length;

	const resetExtraInformation = () => setBulkExtraInformation({});

	const buildPayloadEntities = (
		information?: Scalars["JSON"]["input"],
	): EntityToCollectionInput[] =>
		targetEntities.map((entity) => {
			const payload: EntityToCollectionInput = {
				entityId: entity.entityId,
				entityLot: entity.entityLot,
			};
			if (!isRemoving && information && Object.keys(information).length > 0) {
				payload.information = information;
			}
			return payload;
		});

	const handleBulkAction = async (information?: Scalars["JSON"]["input"]) => {
		const mutation = isRemoving
			? removeEntitiesFromCollection
			: addEntitiesToCollection;
		const actionText = isRemoving ? "Removing" : "Adding";

		await mutation.mutateAsync({
			collectionName: collection.name,
			creatorUserId: collection.creatorUserId,
			entities: buildPayloadEntities(information),
		});

		notifications.show({
			color: "green",
			title: "Success",
			message: `${actionText} ${targetEntities.length} item${targetEntities.length === 1 ? "" : "s"} ${isRemoving ? "from" : "to"} collection`,
		});

		resetExtraInformation();
		bulkEditingCollectionState.stop();
	};

	const getConfirmationMessage = () => {
		const itemCount = targetEntities.length;
		return `Are you sure you want to ${action} ${itemCount} item${itemCount === 1 ? "" : "s"} ${isRemoving ? "from" : "to"} "${collection.name}"?`;
	};

	const handleConfirmBulkAction = () => {
		if (requiresExtraInformation) {
			openExtraInformationModal();
			return;
		}
		openConfirmationModal(
			getConfirmationMessage(),
			() => void handleBulkAction(),
		);
	};

	const closeExtraInformation = () => {
		closeExtraInformationModal();
		resetExtraInformation();
	};

	const handleExtraInformationSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const information = bulkExtraInformation;
		openConfirmationModal(getConfirmationMessage(), () =>
			handleBulkAction(information).then(() => closeExtraInformation()),
		);
	};

	const isLoading =
		addEntitiesToCollection.isPending || removeEntitiesFromCollection.isPending;

	return (
		<>
			<Modal
				centered
				onClose={closeExtraInformation}
				opened={extraInformationModalOpened}
				title={`Add extra information to "${collection.name}"`}
			>
				<form ref={formRef} onSubmit={handleExtraInformationSubmit}>
					<Stack>
						<Text size="sm" c="dimmed">
							The details below will be applied to all selected items.
						</Text>
						{collectionDetails?.informationTemplate?.map((template) => (
							<CollectionTemplateRenderer
								key={template.name}
								template={template}
								value={bulkExtraInformation[template.name]}
								onChange={(value) =>
									setBulkExtraInformation((prev) => ({
										...prev,
										[template.name]: value,
									}))
								}
							/>
						))}
						<Group justify="flex-end">
							<Button
								type="button"
								variant="subtle"
								onClick={closeExtraInformation}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								variant="outline"
								loading={isLoading}
								disabled={!isFormValid || targetEntities.length === 0}
							>
								{changeCase(action)}
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
			<Affix position={{ bottom: rem(30) }} w="100%" px="sm">
				<Paper withBorder shadow="xl" p="md" w={{ md: "40%" }} mx="auto">
					<Group wrap="nowrap" justify="space-between">
						<Text fz={{ base: "xs", md: "md" }}>
							{targetEntities.length} items selected
						</Text>
						<Group wrap="nowrap">
							<ActionIcon
								size="md"
								onClick={() => bulkEditingCollectionState.stop()}
							>
								<IconCancel />
							</ActionIcon>
							<Button
								size="xs"
								color="blue"
								loading={bulkEditingCollectionState.data.isLoading}
								onClick={() =>
									bulkEditingCollectionState.bulkAdd(props.bulkAddEntities)
								}
							>
								Select all items
							</Button>
							<Button
								size="xs"
								loading={isLoading}
								onClick={handleConfirmBulkAction}
								color={isRemoving ? "red" : "green"}
								disabled={
									targetEntities.length === 0 ||
									(!isRemoving && !collectionDetails)
								}
							>
								{changeCase(action)}
							</Button>
						</Group>
					</Group>
				</Paper>
			</Affix>
		</>
	);
};
