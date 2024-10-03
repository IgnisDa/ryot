import type { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import { atom, useAtom } from "jotai";

type BulkEditingCollectionEntity = {
	entityId: string;
	entityLot: EntityLot;
};

export type BulkEditingCollectionData = {
	collectionId: string;
	entities: Array<BulkEditingCollectionEntity>;
};

const bulkEditingCollectionAtom = atom<BulkEditingCollectionData | null>(null);

export const useBulkEditCollection = () => {
	const [bulkEditingCollection, setBulkEditingCollection] = useAtom(
		bulkEditingCollectionAtom,
	);

	const start = (collectionId: string) => {
		setBulkEditingCollection({
			collectionId,
			entities: [],
		});
	};

	const addEntity = (entity: BulkEditingCollectionEntity) => {
		if (!bulkEditingCollection) return;
		if (!bulkEditingCollection.entities.includes(entity))
			setBulkEditingCollection(
				produce(bulkEditingCollection, (draft) => {
					draft.entities.push(entity);
				}),
			);
	};

	const removeEntity = (entity: BulkEditingCollectionEntity) => {
		if (!bulkEditingCollection) return;
		setBulkEditingCollection(
			produce(bulkEditingCollection, (draft) => {
				draft.entities.splice(draft.entities.indexOf(entity), 1);
			}),
		);
	};

	const stop = () => setBulkEditingCollection(null);

	const isActive = Boolean(bulkEditingCollection);

	return {
		stop,
		start,
		isActive,
		addEntity,
		removeEntity,
		entities: bulkEditingCollection?.entities || [],
	};
};
