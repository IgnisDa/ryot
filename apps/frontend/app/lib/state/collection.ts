import type { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { isEqual } from "@ryot/ts-utils";
import { produce } from "immer";
import { atom, useAtom } from "jotai";

type Entity = { entityId: string; entityLot: EntityLot };

type Collection = { id: string; name: string; creatorUserId: string };

type Action = "remove" | "add";

type BulkEditingCollectionData = {
	action: Action;
	collection: Collection;
	entities: Array<Entity>;
	isLoading: boolean;
};

const bulkEditingCollectionAtom = atom<BulkEditingCollectionData | null>(null);

export const useBulkEditCollection = () => {
	const [bec, setBec] = useAtom(bulkEditingCollectionAtom);

	const findIndex = (entity: Entity) =>
		(bec?.entities || []).findIndex((f) => isEqual(f, entity));

	const start = (collection: Collection, action: Action) => {
		setBec({ action, collection, entities: [], isLoading: false });
	};

	return {
		start,
		state: bec
			? {
					data: bec,
					stop: () => setBec(null),
					add: (entity: Entity | Array<Entity>) => {
						if (Array.isArray(entity)) {
							setBec({ ...bec, isLoading: false, entities: entity });
							return;
						}
						if (findIndex(entity) !== -1) return;
						setBec(
							produce(bec, (draft) => {
								draft.entities.push(entity);
							}),
						);
					},
					remove: (entity: Entity) => {
						setBec(
							produce(bec, (draft) => {
								draft.entities.splice(findIndex(entity), 1);
							}),
						);
					},
					isAdded: (entity: Entity) => findIndex(entity) !== -1,
					startLoading: () => setBec({ ...bec, isLoading: true }),
					stopLoading: () => setBec({ ...bec, isLoading: false }),
				}
			: (false as const),
	};
};
