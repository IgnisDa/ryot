import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { sortEntitySchemas } from "./model";

export function useEntitySchemasQuery(facetId: string, enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"get",
		"/entity-schemas",
		{ params: { query: { facetId } } },
		{ enabled },
	);

	return {
		...query,
		entitySchemas: sortEntitySchemas(query.data?.data ?? []),
	};
}

export function useEntitySchemaMutations(facetId: string) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("get", "/entity-schemas", {
		params: { query: { facetId } },
	}).queryKey;
	const savedViewsQueryKey = apiClient.queryOptions(
		"get",
		"/saved-views",
	).queryKey;

	const create = apiClient.useMutation(
		"post",
		"/entity-schemas",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
				queryClient.invalidateQueries({ queryKey: savedViewsQueryKey });
			},
		},
		queryClient,
	);

	return { create };
}
