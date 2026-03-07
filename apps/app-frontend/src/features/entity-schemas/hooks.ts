import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import type { AppEntitySchema } from "./model";
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
		entitySchemas: sortEntitySchemas(
			// OpenAPI spec types propertiesSchema as Record<string, unknown>,
			// but our model uses stricter AppSchema type (Record<string, AppPropertyDefinition>)
			(query.data?.data ?? []) as unknown as AppEntitySchema[],
		),
	};
}

export function useEntitySchemaMutations(facetId: string) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("get", "/entity-schemas", {
		params: { query: { facetId } },
	}).queryKey;

	const create = apiClient.useMutation(
		"post",
		"/entity-schemas",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	return { create };
}
