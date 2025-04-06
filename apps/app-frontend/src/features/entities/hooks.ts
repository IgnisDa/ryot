import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { sortEntities, toAppEntity } from "./model";

export function useEntitiesQuery(entitySchemaId: string, enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"post",
		"/view-runtime/execute",
		{ body: { entitySchemaId } },
		{ enabled },
	);

	return {
		...query,
		entities: sortEntities((query.data?.data ?? []).map(toAppEntity)),
	};
}

export function useEntityQuery(entityId: string, enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"get",
		"/entities/{entityId}",
		{ params: { path: { entityId } } },
		{ enabled },
	);

	return {
		...query,
		entity: query.data?.data ? toAppEntity(query.data.data) : undefined,
	};
}

export function useEntityMutations(entitySchemaId: string) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("post", "/view-runtime/execute", {
		body: { entitySchemaId },
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
