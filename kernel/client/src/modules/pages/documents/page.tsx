import { useNavigate } from "@tanstack/react-router";

import { useCollectionReviewScreen } from "#/modules/collections/review-screen";
import { useCollectionScreens } from "#/modules/collections/screens";
import { type ClientPageDocument, useClientPageDocument } from "#/modules/pages/documents/state";
import { EntityPickerModal } from "#/modules/provider-add/modal";
import { useEntityPickerSession } from "#/modules/provider-add/picker-session";
import { useShareScreen } from "#/modules/publications/share-screen";
import { useReminderScreen } from "#/modules/reminders/screens";

export function ClientPage(props: Pick<ClientPageDocument, "title" | "prepared">) {
	const navigate = useNavigate();
	const { open, session } = useEntityPickerSession();
	const collections = useCollectionScreens();
	const reminders = useReminderScreen();
	const reviews = useCollectionReviewScreen();
	const share = useShareScreen();
	useClientPageDocument({
		...props,
		onPickEntity: open,
		onSharePublication: share.onSharePublication,
		onManageReminders: reminders.onManageReminders,
		onEditCollection: collections.onEditCollection,
		onAddToCollection: collections.onAddToCollection,
		onManageCollectionReviews: reviews.onManageCollectionReviews,
		onChangeCollectionMembers: collections.onChangeCollectionMembers,
		inert: session !== null || collections.open || reviews.open || reminders.open || share.open,
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
			{reviews.screen}
			{reminders.screen}
			{share.screen}
		</>
	);
}
