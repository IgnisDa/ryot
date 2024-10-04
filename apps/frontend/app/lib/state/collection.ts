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
	const [bec, setBec] = useAtom(bulkEditingCollectionAtom);

	const findIndex = (entity: BulkEditingCollectionEntity) =>
		(bec?.entities || []).findIndex((f) => isEqual(f, entity));

	const start = (collection: BulkEditingCollectionDetails) => {
		setBec({ collection, entities: [], isLoading: false });
	};

	const add = (
		entity: BulkEditingCollectionEntity | Array<BulkEditingCollectionEntity>,
	) => {
		if (!bec) return;
		if (Array.isArray(entity)) {
			setBec({ ...bec, entities: entity });
			return;
		}
		if (findIndex(entity) !== -1) return;
		setBec(
			produce(bec, (draft) => {
				draft.entities.push(entity);
			}),
		);
	};

	const remove = (entity: BulkEditingCollectionEntity) => {
		if (!bec) return;
		setBec(
			produce(bec, (draft) => {
				draft.entities.splice(findIndex(entity), 1);
			}),
		);
	};

	const stop = () => setBec(null);

	return {
		add,
		stop,
		start,
		remove,
		state: bec
			? {
					collection: bec.collection,
					size: bec.entities.length,
					entities: bec.entities,
					isLoading: bec.isLoading,
					isAdded: (entity: BulkEditingCollectionEntity) =>
						findIndex(entity) !== -1,
					startLoading: () => setBec({ ...bec, isLoading: true }),
					stopLoading: () => setBec({ ...bec, isLoading: false }),
				}
			: (false as const),
	};
};
