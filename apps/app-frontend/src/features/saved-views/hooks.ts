import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { applySavedViewReorderPatch } from "./cache";
import type { AppSavedView } from "./model";

function isQueryDataWithSavedViews(
	data: unknown,
): data is { data: AppSavedView[] } {
	if (data === null || typeof data !== "object") {
		return false;
	}
	return "data" in data;
}

function extractSavedViewReorderInput(
	input: unknown,
): { viewIds: string[]; trackerId?: string } | undefined {
	return (input as { body?: { viewIds?: string[]; trackerId?: string } }).body
		?.viewIds
		? (input as { body: { viewIds: string[]; trackerId?: string } }).body
		: undefined;
}

interface SavedViewsQueryOptions {
	includeDisabled?: boolean;
}

export function useSavedViewsQuery(options: SavedViewsQueryOptions = {}) {
	const apiClient = useApiClient();
	const includeDisabled = options.includeDisabled ? "true" : undefined;
	const query = apiClient.useQuery("get", "/saved-views", {
		params: { query: { includeDisabled } },
	});

	const savedViews: AppSavedView[] = query.data?.data ?? [];

	return {
		savedViews,
		refetch: query.refetch,
		isError: query.isError,
		isLoading: query.isLoading,
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

	const reorder = apiClient.useMutation(
		"post",
		"/saved-views/reorder",
		{
			onMutate: async (input: unknown) => {
				const mutableListQueryKey = listQueryKey as unknown as unknown[];
				await queryClient.cancelQueries({
					queryKey: mutableListQueryKey,
				});
				const previousData = queryClient.getQueryData(mutableListQueryKey);

				if (isQueryDataWithSavedViews(previousData)) {
					const reorderInput = extractSavedViewReorderInput(input);
					if (reorderInput) {
						queryClient.setQueryData(listQueryKey, {
							data: applySavedViewReorderPatch(previousData.data, reorderInput),
						});
					}
				}

				return { previousData };
			},
			onError: (_err: unknown, _variables: unknown, ctx) => {
				if (ctx?.previousData) {
					queryClient.setQueryData(listQueryKey, ctx.previousData);
				}
			},
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

	const reorderViewIds = async (input: {
		viewIds: string[];
		trackerId?: string;
	}) => {
		await reorder.mutateAsync({
			body: {
				viewIds: input.viewIds,
				...(input.trackerId ? { trackerId: input.trackerId } : {}),
			},
		});
	};

	return {
		update,
		reorder,
		toggleViewById,
		reorderViewIds,
		isPending: update.isPending || reorder.isPending,
	};
}
