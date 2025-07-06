import type {
	CollectionExtraInformation,
	EntityLot,
	UserCollectionsListQuery,
	UsersListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { isEqual } from "@ryot/ts-utils";
import { produce } from "immer";
import { atom, useAtom } from "jotai";
import { useLocation, useNavigate } from "react-router";

type Entity = { entityId: string; entityLot: EntityLot };

type Collection = { id: string; name: string; creatorUserId: string };

type Action = "remove" | "add";

type BulkEditingCollectionData = {
	action: Action;
	isLoading: boolean;
	collection: Collection;
	entities: Array<Entity>;
	locationStartedFrom: string;
};

export type BulkAddEntities = () => Promise<Array<Entity>>;

export type CreateOrUpdateCollectionModalData = {
	id?: string;
	name?: string;
	isDefault?: boolean;
	description?: string;
	informationTemplate?: CollectionExtraInformation[] | null;
	collaborators?: UserCollectionsListQuery["userCollectionsList"]["response"][number]["collaborators"];
};

const bulkEditingCollectionAtom = atom<BulkEditingCollectionData | null>(null);

const createOrUpdateCollectionModalAtom = atom<{
	isOpen: boolean;
	usersList: UsersListQuery["usersList"];
	data: CreateOrUpdateCollectionModalData | null;
}>({ isOpen: false, data: null, usersList: [] });

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
						setBec(null);
						navigate(bec.locationStartedFrom);
					},
					add: (toAdd: Entity) => {
						if (findIndex(toAdd) !== -1) return;
						setBec(
							produce(bec, (draft) => {
								draft.entities.push(toAdd);
							}),
						);
					},
					bulkAdd: async (getEntities: BulkAddEntities) => {
						setBec({ ...bec, isLoading: true });
						const entities = await getEntities();
						setBec({ ...bec, isLoading: false, entities });
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

export const useCreateOrUpdateCollectionModal = () => {
	const [modal, setModal] = useAtom(createOrUpdateCollectionModalAtom);

	const open = (
		data: CreateOrUpdateCollectionModalData | null,
		usersList: UsersListQuery["usersList"],
	) => {
		setModal({ isOpen: true, data, usersList });
	};

	const close = () => {
		setModal({ isOpen: false, data: null, usersList: [] });
	};

	return {
		open,
		close,
		data: modal.data,
		isOpen: modal.isOpen,
		usersList: modal.usersList,
	};
};
