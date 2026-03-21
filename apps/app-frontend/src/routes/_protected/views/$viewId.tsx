import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
	createFileRoute,
	useCanGoBack,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { useSavedViewMutations } from "#/features/saved-views/hooks";
import { SavedViewPage } from "#/features/saved-views/view-page";
import { getErrorMessage } from "#/lib/errors";

export const Route = createFileRoute("/_protected/views/$viewId")({
	component: RouteComponent,
});

function RouteComponent() {
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const navigate = Route.useNavigate();
	const { viewId } = Route.useParams();
	const savedViewMutations = useSavedViewMutations();
	const [actionError, setActionError] = useState<string | null>(null);

	const handleClone = async () => {
		setActionError(null);

		try {
			const clonedView = await savedViewMutations.cloneViewById(viewId);
			await navigate({
				to: "/views/$viewId",
				params: { viewId: clonedView.data.id },
			});
		} catch (error) {
			setActionError(getErrorMessage(error, "Failed to clone saved view."));
		}
	};

	const handleDelete = () => {
		setActionError(null);
		modals.openConfirmModal({
			title: "Delete saved view",
			confirmProps: { color: "red" },
			labels: { confirm: "Delete", cancel: "Cancel" },
			children: (
				<Text size="sm">Delete this saved view? This cannot be undone.</Text>
			),
			onConfirm: async () => {
				try {
					await savedViewMutations.deleteViewById(viewId);
					if (canGoBack) {
						router.history.back();
						return;
					}

					await navigate({ to: "/" });
				} catch (error) {
					setActionError(
						getErrorMessage(error, "Failed to delete saved view."),
					);
				}
			},
		});
	};

	return (
		<SavedViewPage
			viewId={viewId}
			onClone={handleClone}
			onDelete={handleDelete}
			actionError={actionError}
			isCloning={savedViewMutations.clone.isPending}
			isDeleting={savedViewMutations.remove.isPending}
		/>
	);
}
