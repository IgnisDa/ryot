import { Button, MultiSelect, Stack } from "@mantine/core";
import { useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	EntityLot,
	type Scalars,
} from "@ryot/generated/graphql/backend/graphql";
import { groupBy } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useMemo } from "react";
import { Form } from "react-router";
import { Fragment } from "react/jsx-runtime";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { CollectionTemplateRenderer } from "~/components/common";
import {
	useAddEntitiesToCollectionMutation,
	useApplicationEvents,
	useFormValidation,
	useNonHiddenUserCollections,
	useUserDetails,
} from "~/lib/shared/hooks";
import {
	getUserMetadataDetailsQuery,
	getUserMetadataGroupDetailsQuery,
	getUserPersonDetailsQuery,
	queryClient,
	refreshReactQueryMediaKeys,
} from "~/lib/shared/react-query";
import {
	getUserExerciseDetailsQuery,
	getWorkoutDetailsQuery,
	getWorkoutTemplateDetailsQuery,
} from "~/lib/state/fitness";
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

	const alreadyInCollectionsQueryKey = [
		"alreadyInCollections",
		addEntityToCollectionData?.entityId,
	];

	const { data: alreadyInCollections } = useQuery({
		queryKey: alreadyInCollectionsQueryKey,
		queryFn: async () => {
			const entityId = addEntityToCollectionData?.entityId;
			invariant(entityId);
			return match(addEntityToCollectionData?.entityLot)
				.with(EntityLot.Exercise, () =>
					queryClient
						.ensureQueryData(getUserExerciseDetailsQuery(entityId))
						.then((d) => d.collections.map((c) => c.details.collectionId)),
				)
				.with(EntityLot.Workout, () =>
					queryClient
						.ensureQueryData(getWorkoutDetailsQuery(entityId))
						.then((d) => d.collections.map((c) => c.details.collectionId)),
				)
				.with(EntityLot.WorkoutTemplate, () =>
					queryClient
						.ensureQueryData(getWorkoutTemplateDetailsQuery(entityId))
						.then((d) => d.collections.map((c) => c.details.collectionId)),
				)
				.with(EntityLot.Metadata, () =>
					queryClient
						.ensureQueryData(getUserMetadataDetailsQuery(entityId))
						.then((d) => d.collections.map((c) => c.details.collectionId)),
				)
				.with(EntityLot.MetadataGroup, () =>
					queryClient
						.ensureQueryData(getUserMetadataGroupDetailsQuery(entityId))
						.then((d) => d.collections.map((c) => c.details.collectionId)),
				)
				.with(EntityLot.Person, () =>
					queryClient
						.ensureQueryData(getUserPersonDetailsQuery(entityId))
						.then((d) => d.collections.map((c) => c.details.collectionId)),
				)
				.run();
		},
	});

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
					disabled: alreadyInCollections?.includes(c.id.toString()),
				})),
			})),
		[collections, userDetails.id, alreadyInCollections],
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
		queryClient.removeQueries({ queryKey: alreadyInCollectionsQueryKey });
		refreshReactQueryMediaKeys();
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
