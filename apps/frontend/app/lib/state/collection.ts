import { notifications } from "@mantine/notifications";
import { useLocation, useNavigate } from "@remix-run/react";
import {
	CollectionContentsDocument,
	EntityLot,
	MediaLot,
	MetadataGroupsListDocument,
	MetadataListDocument,
	PeopleListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { isEqual } from "@ryot/ts-utils";
import { produce } from "immer";
import { atom, useAtom } from "jotai";
import { clientGqlService } from "../generals";
import { match } from "ts-pattern";
import { $path } from "remix-routes";

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
					stop: (showNotification?: boolean) => {
						if (showNotification)
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
						if (findIndex(toAdd) !== -1) return;
						setBec(
							produce(bec, (draft) => {
								draft.entities.push(toAdd);
							}),
						);
					},
					bulkAdd: async () => {
						setBec({ ...bec, isLoading: true });
						const take = Number.MAX_SAFE_INTEGER;
						const entities = await match(bec.action)
							.with("remove", () =>
								clientGqlService
									.request(CollectionContentsDocument, {
										input: { take, collectionId: bec.collection.id },
									})
									.then((r) => r.collectionContents.results.items),
							)
							.with("add", () => {
								const lot = Object.values(MediaLot).find((ml) =>
									location.pathname.includes(ml),
								);
								if (lot)
									return clientGqlService
										.request(MetadataListDocument, { input: { lot, take } })
										.then((r) =>
											r.metadataList.items.map((m) => ({
												entityId: m,
												entityLot: EntityLot.Metadata,
											})),
										);
								if (
									$path("/media/people/:action", { action: "list" }).includes(
										location.pathname,
									)
								)
									return clientGqlService
										.request(PeopleListDocument, { input: { take } })
										.then((r) =>
											r.peopleList.items.map((p) => ({
												entityId: p,
												entityLot: EntityLot.Person,
											})),
										);
								if (
									$path("/media/groups/:action", { action: "list" }).includes(
										location.pathname,
									)
								)
									return clientGqlService
										.request(MetadataGroupsListDocument, { input: { take } })
										.then((r) =>
											r.metadataGroupsList.items.map((p) => ({
												entityId: p,
												entityLot: EntityLot.MetadataGroup,
											})),
										);
								return [];
							})
							.exhaustive();
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
