import { useApiClient } from "#/hooks/api";
import type { AppSavedView } from "./model";
import { toAppSavedView } from "./model";

export function useSavedViewsQuery() {
	const apiClient = useApiClient();
	const query = apiClient.useQuery("get", "/saved-views");

	const rawViews = query.data?.data ?? [];
	const savedViews: AppSavedView[] = rawViews.map((v) => toAppSavedView(v));

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

	const rawViews = allViewsQuery.data?.data ?? [];
	const savedView = rawViews
		.map((v) => toAppSavedView(v))
		.find((v) => v.id === props.viewId);

	return {
		savedView,
		refetch: allViewsQuery.refetch,
		isError: allViewsQuery.isError,
		isLoading: allViewsQuery.isLoading,
	};
}
