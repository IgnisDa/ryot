import { useQueryClient } from "@tanstack/react-query";

import { useApiClient } from "~/hooks/api";

import { applySavedViewReorderPatch } from "./cache";
import type { AppSavedView } from "./model";

function isQueryDataWithSavedViews(data: unknown): data is { data: AppSavedView[] } {
	if (data === null || typeof data !== "object") {
		return false;
	}
	return "data" in data;
}

function extractSavedViewReorderInput(
	input: unknown,
): { viewSlugs: string[]; trackerId?: string } | undefined {
	if (!input || typeof input !== "object" || !("body" in input)) {
		return undefined;
	}

	const body = input.body;
	if (!body || typeof body !== "object" || !("viewSlugs" in body)) {
		return undefined;
	}
	const trackerId =
		"trackerId" in body && typeof body.trackerId === "string" ? body.trackerId : undefined;

	return Array.isArray(body.viewSlugs)
		? {
				viewSlugs: body.viewSlugs.filter((slug): slug is string => typeof slug === "string"),
				...(trackerId ? { trackerId } : {}),
			}
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
		"/saved-views/{viewSlug}",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	const remove = apiClient.useMutation(
		"delete",
		"/saved-views/{viewSlug}",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	const clone = apiClient.useMutation(
		"post",
		"/saved-views/{viewSlug}/clone",
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
				await queryClient.cancelQueries({ queryKey: listQueryKey });
				const previousData = queryClient.getQueryData(listQueryKey);

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

	const toggleViewBySlug = async (viewSlug: string, savedViews: AppSavedView[]) => {
		const view = savedViews.find((v) => v.slug === viewSlug);
		if (!view) {
			return;
		}
		await update.mutateAsync({
			params: { path: { viewSlug } },
			body: {
				icon: view.icon,
				name: view.name,
				isDisabled: !view.isDisabled,
				accentColor: view.accentColor,
				queryDefinition: view.queryDefinition,
				displayConfiguration: view.displayConfiguration,
				...(view.trackerId !== null ? { trackerId: view.trackerId } : {}),
			},
		});
	};

	const reorderViewSlugs = async (input: { trackerId?: string; viewSlugs: string[] }) => {
		await reorder.mutateAsync({
			body: {
				viewSlugs: input.viewSlugs,
				...(input.trackerId ? { trackerId: input.trackerId } : {}),
			},
		});
	};

	const deleteViewBySlug = async (viewSlug: string) => {
		return await remove.mutateAsync({ params: { path: { viewSlug } } });
	};

	const cloneViewBySlug = async (viewSlug: string) => {
		return await clone.mutateAsync({ params: { path: { viewSlug } } });
	};

	return {
		clone,
		remove,
		update,
		reorder,
		cloneViewBySlug,
		deleteViewBySlug,
		toggleViewBySlug,
		reorderViewSlugs,
		isPending: update.isPending || reorder.isPending || remove.isPending || clone.isPending,
	};
}
