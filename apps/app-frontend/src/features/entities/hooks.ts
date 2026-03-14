import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { sortEntities } from "./model";

export function useEntitiesQuery(entitySchemaId: string, enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"get",
		"/entities",
		{ params: { query: { entitySchemaId } } },
		{ enabled },
	);

	return {
		...query,
		entities: sortEntities(
			(query.data?.data ?? []).map((entity) => ({
				...entity,
				createdAt: new Date(entity.createdAt),
				updatedAt: new Date(entity.updatedAt),
			})),
		),
	};
}

export function useEntityMutations(entitySchemaId: string) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("get", "/entities", {
		params: { query: { entitySchemaId } },
	}).queryKey;

	const create = apiClient.useMutation(
		"post",
		"/entities",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	return { create };
}
