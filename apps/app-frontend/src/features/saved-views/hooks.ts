import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import type { AppSavedView } from "./model";

export function useSavedViewsQuery() {
	const apiClient = useApiClient();
	const query = apiClient.useQuery("get", "/saved-views");

	const savedViews: AppSavedView[] = query.data?.data ?? [];

	return {
		savedViews,
		refetch: query.refetch,
		isError: query.isError,
		isLoading: query.isLoading,
	};
}

export function useSavedViewQuery(props: { viewId: string }) {
	const apiClient = useApiClient();
	const allViewsQuery = apiClient.useQuery("get", "/saved-views");

	const savedView = (allViewsQuery.data?.data ?? []).find(
		(v) => v.id === props.viewId,
	);

	return {
		savedView,
		refetch: allViewsQuery.refetch,
		isError: allViewsQuery.isError,
		isLoading: allViewsQuery.isLoading,
	};
}

export function useSavedViewMutations() {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("get", "/saved-views").queryKey;

	const update = apiClient.useMutation(
		"put",
		"/saved-views/{viewId}",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	const toggleViewById = async (viewId: string, savedViews: AppSavedView[]) => {
		const view = savedViews.find((v) => v.id === viewId);
		if (!view) {
			return;
		}
		await update.mutateAsync({
			body: {
				icon: view.icon,
				name: view.name,
				isDisabled: !view.isDisabled,
				accentColor: view.accentColor,
				queryDefinition: view.queryDefinition,
				displayConfiguration: view.displayConfiguration,
				...(view.trackerId !== null ? { trackerId: view.trackerId } : {}),
			},
			params: { path: { viewId } },
		});
	};

	return { update, toggleViewById, isPending: update.isPending };
}
