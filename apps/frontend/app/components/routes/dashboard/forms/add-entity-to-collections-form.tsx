import { Button, MultiSelect, Stack } from "@mantine/core";
import { useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { Scalars } from "@ryot/generated/graphql/backend/graphql";
import { groupBy } from "@ryot/ts-utils";
import { type FormEvent, useMemo } from "react";
import { Form } from "react-router";
import { Fragment } from "react/jsx-runtime";
import { CollectionTemplateRenderer } from "~/components/common/CollectionTemplateRenderer";
import {
	useAddEntitiesToCollectionMutation,
	useApplicationEvents,
	useEntityAlreadyInCollections,
	useFormValidation,
	useNonHiddenUserCollections,
	useUserDetails,
} from "~/lib/shared/hooks";
import { refreshEntityDetails } from "~/lib/shared/react-query";
import { useAddEntityToCollections } from "~/lib/state/media";
import type { Collection } from "../types";

export const AddEntityToCollectionsForm = ({
	closeAddEntityToCollectionsDrawer,
}: {
	closeAddEntityToCollectionsDrawer: () => void;
}) => {
	const userDetails = useUserDetails();
	const collections = useNonHiddenUserCollections();
	const events = useApplicationEvents();
	const [addEntityToCollectionData] = useAddEntityToCollections();
	const addEntitiesToCollection = useAddEntitiesToCollectionMutation();
	const { alreadyInCollectionIds } = useEntityAlreadyInCollections(
		addEntityToCollectionData?.entityId,
		addEntityToCollectionData?.entityLot,
	);

	const [selectedCollections, selectedCollectionsHandlers] = useListState<
		Collection & { userExtraInformationData: Scalars["JSON"]["input"] }
	>([]);

	const { formRef, isFormValid } = useFormValidation(selectedCollections);

	const selectData = useMemo(
		() =>
			Object.entries(
				groupBy(collections, (c) =>
					c.creator.id === userDetails.id ? "You" : c.creator.name,
				),
			).map(([g, items]) => ({
				group: g,
				items: items.map((c) => ({
					label: c.name,
					value: c.id.toString(),
					disabled: alreadyInCollectionIds?.includes(c.id.toString()),
				})),
			})),
		[collections, userDetails.id, alreadyInCollectionIds],
	);

	if (!addEntityToCollectionData) return null;

	const handleCollectionChange = (ids: string[]) => {
		for (const id of ids) {
			if (!selectedCollections.some((c) => c.id === id)) {
				const col = collections.find((c) => c.id === id);
				if (col)
					selectedCollectionsHandlers.append({
						...col,
						userExtraInformationData: {},
					});
			}
		}
		for (let i = selectedCollections.length - 1; i >= 0; i--) {
			if (!ids.includes(selectedCollections[i].id))
				selectedCollectionsHandlers.remove(i);
		}
	};

	const handleCustomFieldChange = (
		colId: string,
		field: string,
		value: unknown,
	) => {
		const idx = selectedCollections.findIndex((c) => c.id === colId);
		if (idx !== -1) {
			selectedCollectionsHandlers.setItemProp(idx, "userExtraInformationData", {
				...selectedCollections[idx].userExtraInformationData,
				[field]: value,
			});
		}
	};

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!addEntityToCollectionData) return;

		await Promise.all(
			selectedCollections.map((col) =>
				addEntitiesToCollection.mutateAsync({
					collectionName: col.name,
					creatorUserId: col.creator.id,
					entities: [
						{
							information: col.userExtraInformationData,
							entityId: addEntityToCollectionData.entityId,
							entityLot: addEntityToCollectionData.entityLot,
						},
					],
				}),
			),
		);
		notifications.show({
			color: "green",
			title: "Added to collection",
			message: `Entity added to ${selectedCollections.length} collection(s)`,
		});
		refreshEntityDetails(addEntityToCollectionData.entityId);
		closeAddEntityToCollectionsDrawer();
		events.addToCollection(addEntityToCollectionData.entityLot);
	};

	return (
		<Form ref={formRef} onSubmit={handleSubmit}>
			<Stack>
				<MultiSelect
					required
					searchable
					data={selectData}
					label="Select collections"
					nothingFoundMessage="Nothing found..."
					onChange={(v) => handleCollectionChange(v)}
					value={selectedCollections.map((c) => c.id)}
				/>
				{selectedCollections.map((col) => (
					<Fragment key={col.id}>
						{col.informationTemplate?.map((template) => (
							<CollectionTemplateRenderer
								key={template.name}
								template={template}
								value={col.userExtraInformationData[template.name]}
								onChange={(value) =>
									handleCustomFieldChange(col.id, template.name, value)
								}
							/>
						))}
					</Fragment>
				))}
				<Button
					type="submit"
					variant="outline"
					disabled={!isFormValid}
					loading={addEntitiesToCollection.isPending}
				>
					Set
				</Button>
			</Stack>
		</Form>
	);
};
