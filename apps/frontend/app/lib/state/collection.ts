import type { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { enableMapSet, produce } from "immer";
import { atom, useAtom } from "jotai";

enableMapSet();

type BulkEditingCollectionEntity = {
	entityId: string;
	entityLot: EntityLot;
};

export type BulkEditingCollectionData = {
	collectionId: string;
	entities: Set<BulkEditingCollectionEntity>;
};

const bulkEditingCollectionAtom = atom<BulkEditingCollectionData | null>(null);

export const useBulkEditCollection = () => {
	const [bulkEditingCollection, setBulkEditingCollection] = useAtom(
		bulkEditingCollectionAtom,
	);

	const start = (collectionId: string) => {
		setBulkEditingCollection({ collectionId, entities: new Set() });
	};

	const addEntity = (entity: BulkEditingCollectionEntity) => {
		if (!bulkEditingCollection) return;
		setBulkEditingCollection(
			produce(bulkEditingCollection, (draft) => {
				draft.entities.add(entity);
			}),
		);
	};

	const removeEntity = (entity: BulkEditingCollectionEntity) => {
		if (!bulkEditingCollection) return;
		setBulkEditingCollection(
			produce(bulkEditingCollection, (draft) => {
				draft.entities.delete(entity);
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
		entities: bulkEditingCollection ? [...bulkEditingCollection.entities] : [],
	};
};
