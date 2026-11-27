import type {
	AddToCollectionOutcome,
	AddToCollectionRequest,
	ChangeCollectionMembersOutcome,
	ChangeCollectionMembersRequest,
	EditCollectionOutcome,
	EditCollectionRequest,
} from "@ryot-app/plugin-client-contract";

import { AddToCollection } from "#/modules/collections/add-to-collection";
import { ChangeCollectionMembers } from "#/modules/collections/change-members";
import { CollectionEditor } from "#/modules/collections/collection-editor";
import { useHostScreenSession } from "#/modules/ui/host-screen-session";

export function useCollectionScreens() {
	const edit = useHostScreenSession<EditCollectionRequest, EditCollectionOutcome>({
		kind: "cancelled",
	});
	const add = useHostScreenSession<AddToCollectionRequest, AddToCollectionOutcome>({
		kind: "cancelled",
	});
	const members = useHostScreenSession<
		ChangeCollectionMembersRequest,
		ChangeCollectionMembersOutcome
	>({ kind: "cancelled" });
	const editSession = edit.session;
	const addSession = add.session;
	const membersSession = members.session;
	return {
		onEditCollection: edit.open,
		onAddToCollection: add.open,
		onChangeCollectionMembers: members.open,
		open: editSession !== null || addSession !== null || membersSession !== null,
		screen: (
			<>
				{editSession === null ? null : (
					<CollectionEditor
						collectionId={editSession.request.collectionId}
						onDeleted={() => editSession.complete({ kind: "deleted" })}
						onClose={() => editSession.complete({ kind: "cancelled" })}
						onSaved={(collectionId) => editSession.complete({ collectionId, kind: "saved" })}
					/>
				)}
				{addSession === null ? null : (
					<AddToCollection
						entityId={addSession.request.entityId}
						collectionId={addSession.request.collectionId}
						onSaved={() => addSession.complete({ kind: "saved" })}
						onRemoved={() => addSession.complete({ kind: "removed" })}
						onClose={() => addSession.complete({ kind: "cancelled" })}
					/>
				)}
				{membersSession === null ? null : (
					<ChangeCollectionMembers
						request={membersSession.request}
						complete={membersSession.complete}
					/>
				)}
			</>
		),
	};
}
