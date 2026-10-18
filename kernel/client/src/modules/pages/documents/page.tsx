import { useNavigate } from "@tanstack/react-router";

import { useCollectionScreens } from "#/modules/collections/screens";
import { type ClientPageDocument, useClientPageDocument } from "#/modules/pages/documents/state";
import { EntityPickerModal } from "#/modules/provider-add/modal";
import { useEntityPickerSession } from "#/modules/provider-add/picker-session";

export function ClientPage(props: Pick<ClientPageDocument, "title" | "prepared">) {
	const navigate = useNavigate();
	const { open, session } = useEntityPickerSession();
	const collections = useCollectionScreens();
	useClientPageDocument({
		...props,
		onPickEntity: open,
		inert: session !== null || collections.open,
		onEditCollection: collections.onEditCollection,
		onAddToCollection: collections.onAddToCollection,
	});
	return (
		<>
			{session === null ? null : (
				<EntityPickerModal
					onComplete={session.complete}
					schema={session.request.schema}
					library={session.request.library}
					initialQuery={session.request.initialQuery}
					onCreate={(href) => void navigate({ href })}
					onClose={() => session.complete({ kind: "cancelled" })}
				/>
			)}
			{collections.screen}
		</>
	);
}
