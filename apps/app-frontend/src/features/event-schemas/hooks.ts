import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { sortEventSchemas } from "./model";

export function useEventSchemasQuery(entitySchemaId: string, enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"get",
		"/event-schemas",
		{ params: { query: { entitySchemaId } } },
		{ enabled },
	);

	return {
		...query,
		eventSchemas: sortEventSchemas(query.data?.data ?? []),
	};
}

export function useEventSchemaMutations(entitySchemaId: string) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("get", "/event-schemas", {
		params: { query: { entitySchemaId } },
	}).queryKey;

	const create = apiClient.useMutation(
		"post",
		"/event-schemas",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	return { create };
}
