import { Button, MultiSelect, Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { Scalars } from "@ryot/generated/graphql/backend/graphql";
import { groupBy } from "@ryot/ts-utils";
import { useMemo } from "react";
import { Fragment } from "react/jsx-runtime";
import { CollectionTemplateRenderer } from "~/components/common/collection-template-renderer";
import { useSavedForm } from "~/lib/hooks/use-saved-form";
import {
	useAddEntitiesToCollectionMutation,
	useApplicationEvents,
	useEntityAlreadyInCollections,
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
	const events = useApplicationEvents();
	const collections = useNonHiddenUserCollections();
	const [addEntityToCollectionData] = useAddEntityToCollections();
	const addEntitiesToCollection = useAddEntitiesToCollectionMutation();
	const { alreadyInCollectionIds } = useEntityAlreadyInCollections(
		addEntityToCollectionData?.entityId,
		addEntityToCollectionData?.entityLot,
	);

	const form = useSavedForm<{
		selectedCollections: Array<
			Collection & { userExtraInformationData: Scalars["JSON"]["input"] }
		>;
	}>({
		initialValues: { selectedCollections: [] },
		storageKeyPrefix: `AddEntityToCollectionsForm-${addEntityToCollectionData?.entityId}`,
		validate: {
			selectedCollections: (value) =>
				value.length > 0 ? null : "Select at least one collection",
		},
	});

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
		const currentCollections = form.values.selectedCollections;
		const newCollections = [...currentCollections];

		for (const id of ids) {
			if (!newCollections.some((c) => c.id === id)) {
				const col = collections.find((c) => c.id === id);
				if (col) {
					newCollections.push({
						...col,
						userExtraInformationData: {},
					});
				}
			}
		}

		const filteredCollections = newCollections.filter((c) =>
			ids.includes(c.id),
		);
		form.setFieldValue("selectedCollections", filteredCollections);
	};

	const handleCustomFieldChange = (
		colId: string,
		field: string,
		value: unknown,
	) => {
		const idx = form.values.selectedCollections.findIndex(
			(c) => c.id === colId,
		);
		if (idx !== -1) {
			const newCollections = [...form.values.selectedCollections];
			newCollections[idx] = {
				...newCollections[idx],
				userExtraInformationData: {
					...newCollections[idx].userExtraInformationData,
					[field]: value,
				},
			};
			form.setFieldValue("selectedCollections", newCollections);
		}
	};

	return (
		<form
			onSubmit={form.onSubmit(async (values) => {
				if (!addEntityToCollectionData) return;

				await Promise.all(
					values.selectedCollections.map((col) =>
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
					message: `Entity added to ${values.selectedCollections.length} collection(s)`,
				});
				refreshEntityDetails(addEntityToCollectionData.entityId);
				form.clearSavedState();
				closeAddEntityToCollectionsDrawer();
				events.addToCollection(addEntityToCollectionData.entityLot);
			})}
		>
			<Stack>
				<MultiSelect
					required
					searchable
					data={selectData}
					label="Select collections"
					nothingFoundMessage="Nothing found..."
					onChange={(v) => handleCollectionChange(v)}
					value={form.values.selectedCollections.map((c) => c.id)}
				/>
				{form.values.selectedCollections.map((col) => (
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
					loading={addEntitiesToCollection.isPending}
				>
					Set
				</Button>
			</Stack>
		</form>
	);
};
