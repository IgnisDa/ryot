import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "~/hooks/api";
import { createEntityRuntimeRequest, sortEntities, toAppEntity } from "./model";

export function useEntitiesQuery(entitySchemaSlug: string, enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"post",
		"/query-engine/execute",
		{ body: createEntityRuntimeRequest(entitySchemaSlug) },
		{ enabled },
	);

	return {
		...query,
		entities: sortEntities((query.data?.data.items ?? []).map(toAppEntity)),
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

export function useEntityMutations(entitySchemaSlug: string) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("post", "/query-engine/execute", {
		body: createEntityRuntimeRequest(entitySchemaSlug),
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
