import type { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { isEqual } from "@ryot/ts-utils";
import { produce } from "immer";
import { atom, useAtom } from "jotai";

type BulkEditingCollectionEntity = { entityId: string; entityLot: EntityLot };

type BulkEditingCollectionDetails = {
	id: string;
	name: string;
	creatorUserId: string;
};

export type BulkEditingCollectionData = {
	collection: BulkEditingCollectionDetails;
	entities: Array<BulkEditingCollectionEntity>;
	isLoading: boolean;
};

const bulkEditingCollectionAtom = atom<BulkEditingCollectionData | null>(null);

export const useBulkEditCollection = () => {
	const [bulkEditingCollection, setBulkEditingCollection] = useAtom(
		bulkEditingCollectionAtom,
	);

	const findIndex = (entity: BulkEditingCollectionEntity) =>
		(bulkEditingCollection?.entities || []).findIndex((f) =>
			isEqual(f, entity),
		);

	const start = (collection: BulkEditingCollectionDetails) => {
		setBulkEditingCollection({ collection, entities: [], isLoading: false });
	};

	const add = (
		entity: BulkEditingCollectionEntity | Array<BulkEditingCollectionEntity>,
	) => {
		if (!bulkEditingCollection) return;
		if (Array.isArray(entity)) {
			setBulkEditingCollection({ ...bulkEditingCollection, entities: entity });
			return;
		}
		if (findIndex(entity) !== -1) return;
		setBulkEditingCollection(
			produce(bulkEditingCollection, (draft) => {
				draft.entities.push(entity);
			}),
		);
	};

	const remove = (entity: BulkEditingCollectionEntity) => {
		if (!bulkEditingCollection) return;
		setBulkEditingCollection(
			produce(bulkEditingCollection, (draft) => {
				draft.entities.splice(findIndex(entity), 1);
			}),
		);
	};

	const stop = () => setBulkEditingCollection(null);

	return {
		add,
		stop,
		start,
		remove,
		state: bulkEditingCollection
			? {
					collection: bulkEditingCollection.collection,
					size: bulkEditingCollection.entities.length,
					entities: bulkEditingCollection.entities,
					isLoading: bulkEditingCollection.isLoading,
					isAdded: (entity: BulkEditingCollectionEntity) =>
						findIndex(entity) !== -1,
					startLoading: () =>
						setBulkEditingCollection({
							...bulkEditingCollection,
							isLoading: true,
						}),
					stopLoading: () =>
						setBulkEditingCollection({
							...bulkEditingCollection,
							isLoading: false,
						}),
				}
			: (false as const),
	};
};
