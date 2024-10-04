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
		setBulkEditingCollection({ collectionId, entities: [] });
	};

	const addEntity = (
		entity: BulkEditingCollectionEntity | Array<BulkEditingCollectionEntity>,
	) => {
		if (!bulkEditingCollection) return;
		if (Array.isArray(entity)) {
			setBulkEditingCollection({ ...bulkEditingCollection, entities: entity });
			return;
		}
		if (bulkEditingCollection.entities.includes(entity)) return;
		setBulkEditingCollection(
			produce(bulkEditingCollection, (draft) => {
				draft.entities.push(entity);
			}),
		);
	};

	const removeEntity = (entity: BulkEditingCollectionEntity) => {
		setBulkEditingCollection((c) =>
			produce(c, (draft) => {
				draft?.entities.splice(
					draft.entities.findIndex((f) => f === entity),
					1,
				);
			}),
		);
	};

	const stop = () => setBulkEditingCollection(null);

	return {
		stop,
		start,
		addEntity,
		removeEntity,
		state: bulkEditingCollection
			? {
					size: bulkEditingCollection.entities.length,
					entities: bulkEditingCollection.entities,
				}
			: (false as const),
	};
};
