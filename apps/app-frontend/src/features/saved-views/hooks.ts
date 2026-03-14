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
