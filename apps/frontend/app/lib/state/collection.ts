import { notifications } from "@mantine/notifications";
import { useLocation, useNavigate } from "@remix-run/react";
import {
	CollectionContentsDocument,
	type EntityLot,
} from "@ryot/generated/graphql/backend/graphql";
import { isEqual } from "@ryot/ts-utils";
import { produce } from "immer";
import { atom, useAtom } from "jotai";
import { clientGqlService } from "../generals";

type Entity = { entityId: string; entityLot: EntityLot };

type Collection = { id: string; name: string; creatorUserId: string };

type Action = "remove" | "add";

type BulkEditingCollectionData = {
	action: Action;
	locationStartedFrom: string;
	collection: Collection;
	entities: Array<Entity>;
	isLoading: boolean;
};

const bulkEditingCollectionAtom = atom<BulkEditingCollectionData | null>(null);

export const useBulkEditCollection = () => {
	const [bec, setBec] = useAtom(bulkEditingCollectionAtom);
	const location = useLocation();
	const navigate = useNavigate();

	const findIndex = (toFind: Entity) =>
		(bec?.entities || []).findIndex((inHere) => isEqual(inHere, toFind));

	const start = (collection: Collection, action: Action) => {
		setBec({
			action,
			collection,
			entities: [],
			isLoading: false,
			locationStartedFrom: location.pathname,
		});
	};

	return {
		start,
		isAdded: (entity: Entity) => findIndex(entity) !== -1,
		state: bec
			? {
					data: bec,
					stop: () => {
						notifications.show({
							title: "Success",
							message:
								bec.action === "remove"
									? "Items will be removed from the collection"
									: "Items will be added to the collection",
							color: "green",
						});
						setBec(null);
						navigate(bec.locationStartedFrom);
					},
					add: (toAdd: Entity) => {
						if (Array.isArray(toAdd)) {
							setBec({ ...bec, isLoading: false, entities: toAdd });
							return;
						}
						if (findIndex(toAdd) !== -1) return;
						setBec(
							produce(bec, (draft) => {
								draft.entities.push(toAdd);
							}),
						);
					},
					bulkAdd: async () => {
						setBec({ ...bec, isLoading: true });
						const { collectionContents } = await clientGqlService.request(
							CollectionContentsDocument,
							{
								input: {
									collectionId: bec.collection.id,
									take: Number.MAX_SAFE_INTEGER,
								},
							},
						);
						setBec({
							...bec,
							isLoading: false,
							entities: collectionContents.results.items,
						});
					},
					remove: (toRemove: Entity) => {
						setBec(
							produce(bec, (draft) => {
								draft.entities.splice(findIndex(toRemove), 1);
							}),
						);
					},
					stopLoading: () => setBec({ ...bec, isLoading: false }),
				}
			: (false as const),
	};
};
