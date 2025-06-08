import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	useCanGoBack,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import {
	type CreateCollectionFormPayload,
	CreateCollectionModal,
} from "~/features/collections/create-modal";
import { useCollectionMutations } from "~/features/collections/hooks";
import { useSavedViewMutations } from "~/features/saved-views/hooks";
import { SavedViewPage } from "~/features/saved-views/view-page";
import { useApiClient } from "~/hooks/api";
import { useModalForm } from "~/hooks/modal-form";
import { getErrorMessage } from "~/lib/errors";

export const Route = createFileRoute("/_protected/views/$viewId")({
	component: RouteComponent,
});

function RouteComponent() {
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const apiClient = useApiClient();
	const navigate = Route.useNavigate();
	const { viewId } = Route.useParams();
	const queryClient = useQueryClient();
	const savedViewMutations = useSavedViewMutations();
	const collectionMutations = useCollectionMutations();
	const [actionError, setActionError] = useState<string | null>(null);

	const runtimeQueryKey = apiClient.queryOptions(
		"post",
		"/query-engine/execute",
	).queryKey;

	const createCollectionModal = useModalForm(
		async (payload: CreateCollectionFormPayload) => {
			await collectionMutations.createCollection(
				payload.name,
				payload.membershipPropertiesSchema,
			);
			await queryClient.invalidateQueries({ queryKey: runtimeQueryKey });
		},
	);

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
		<>
			<SavedViewPage
				viewId={viewId}
				onClone={handleClone}
				onDelete={handleDelete}
				actionError={actionError}
				isCloning={savedViewMutations.clone.isPending}
				isDeleting={savedViewMutations.remove.isPending}
				onCreateCollection={createCollectionModal.open}
				isCreatingCollection={collectionMutations.create.isPending}
			/>
			<CreateCollectionModal
				opened={createCollectionModal.opened}
				onClose={createCollectionModal.close}
				onSubmit={createCollectionModal.submit}
				errorMessage={createCollectionModal.errorMessage}
				isSubmitting={collectionMutations.create.isPending}
			/>
		</>
	);
}
