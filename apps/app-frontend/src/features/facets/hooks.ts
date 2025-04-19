import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { applyFacetEnabledPatch, applyFacetReorderPatch } from "./cache";
import type { AppFacet } from "./model";
import {
	findEnabledFacetBySlug,
	selectEnabledFacets,
	sortFacetsByOrder,
} from "./model";

function extractFacetIdFromInput(input: unknown): string | undefined {
	return (input as { params?: { path?: { facetId: string } } }).params?.path
		?.facetId;
}

function extractFacetIdsFromInput(input: unknown): string[] | undefined {
	return (input as { body?: { facetIds?: string[] } }).body?.facetIds;
}

function isQueryDataWithFacets(data: unknown): data is { data: AppFacet[] } {
	if (data === null || typeof data !== "object") return false;
	return "data" in data;
}

function createMutationHandler<T extends string | string[]>(
	queryClient: ReturnType<typeof useQueryClient>,
	listQueryKey: readonly unknown[],
	applyPatch: (data: AppFacet[], id: T) => AppFacet[],
	extractInput: (input: unknown) => T | undefined,
) {
	return {
		onMutate: async (input: unknown) => {
			await queryClient.cancelQueries({ queryKey: listQueryKey as unknown[] });
			const previousData = queryClient.getQueryData(listQueryKey as unknown[]);

			if (isQueryDataWithFacets(previousData)) {
				const inputValue = extractInput(input);
				if (inputValue)
					queryClient.setQueryData(listQueryKey, {
						data: applyPatch(previousData.data, inputValue),
					});
			}

			return { previousData };
		},
		onError: (_err: unknown, _variables: unknown, context: unknown) => {
			const ctx = context as { previousData?: unknown } | undefined;
			if (ctx?.previousData)
				queryClient.setQueryData(listQueryKey, ctx.previousData);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: listQueryKey });
		},
	};
}

export function useFacetsQuery() {
	const apiClient = useApiClient();
	const query = apiClient.useQuery("get", "/facets/list");

	const rawFacets = query.data?.data ?? [];
	const facets = sortFacetsByOrder(rawFacets);
	const enabledFacets = selectEnabledFacets(facets);

	return {
		...query,
		facets,
		enabledFacets,
		facetBySlug: (slug: string) => findEnabledFacetBySlug(facets, slug),
	};
}

export function useFacetMutations() {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("get", "/facets/list").queryKey;

	const create = apiClient.useMutation(
		"post",
		"/facets/create",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	const update = apiClient.useMutation(
		"patch",
		"/facets/{facetId}",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	const enable = apiClient.useMutation(
		"post",
		"/facets/{facetId}/enable",
		createMutationHandler(
			queryClient,
			listQueryKey,
			(data, id) => applyFacetEnabledPatch(data, id, true),
			extractFacetIdFromInput,
		),
		queryClient,
	);

	const disable = apiClient.useMutation(
		"post",
		"/facets/{facetId}/disable",
		createMutationHandler(
			queryClient,
			listQueryKey,
			(data, id) => applyFacetEnabledPatch(data, id, false),
			extractFacetIdFromInput,
		),
		queryClient,
	);

	const reorder = apiClient.useMutation(
		"post",
		"/facets/reorder",
		createMutationHandler(
			queryClient,
			listQueryKey,
			(data, ids) => applyFacetReorderPatch(data, ids),
			extractFacetIdsFromInput,
		),
		queryClient,
	);

	return { create, update, enable, disable, reorder };
}
