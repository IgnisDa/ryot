import type {
	EntityLot,
	Scalars,
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
	locationStartedFrom: string;
	targetEntities: Array<Entity>;
};

export type BulkAddEntities = () => Promise<Array<Entity>>;

const bulkEditingCollectionAtom = atom<BulkEditingCollectionData | null>(null);

export const useBulkEditCollection = () => {
	const [bec, setBec] = useAtom(bulkEditingCollectionAtom);
	const location = useLocation();
	const navigate = useNavigate();

	const findIndex = (toFind: Entity) =>
		(bec?.targetEntities || []).findIndex((inHere) => isEqual(inHere, toFind));

	const start = async (collection: Collection, action: Action) => {
		setBec({
			action,
			collection,
			isLoading: false,
			targetEntities: [],
			locationStartedFrom: location.pathname,
		});
	};

	return {
		start,
		isAdded: (entity: Entity) => findIndex(entity) !== -1,
		state: bec
			? {
					data: bec,
					stopLoading: () => setBec({ ...bec, isLoading: false }),
					stop: () => {
						setBec(null);
						navigate(bec.locationStartedFrom);
					},
					bulkAdd: async (getEntities: BulkAddEntities) => {
						setBec({ ...bec, isLoading: true });
						const entities = await getEntities();
						setBec({ ...bec, isLoading: false, targetEntities: entities });
					},
					remove: (toRemove: Entity) => {
						setBec(
							produce(bec, (draft) => {
								draft.targetEntities.splice(findIndex(toRemove), 1);
							}),
						);
					},
					add: (toAdd: Entity) => {
						if (findIndex(toAdd) !== -1) return;
						setBec(
							produce(bec, (draft) => {
								draft.targetEntities.push(toAdd);
							}),
						);
					},
				}
			: (false as const),
	};
};

export type CreateOrUpdateCollectionModalData = {
	collectionId?: string;
};

const createOrUpdateCollectionModalAtom = atom<{
	isOpen: boolean;
	usersList: UsersListQuery["usersList"];
	data: CreateOrUpdateCollectionModalData | null;
}>({ isOpen: false, data: null, usersList: [] });

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

export type EditEntityCollectionInformationData = {
	entityId: string;
	collectionId: string;
	entityLot: EntityLot;
	creatorUserId: string;
	collectionName: string;
	existingInformation: Scalars["JSON"]["input"];
};

const editEntityCollectionInformationAtom =
	atom<EditEntityCollectionInformationData | null>(null);

export const useEditEntityCollectionInformation = () => {
	return useAtom(editEntityCollectionInformationAtom);
};
