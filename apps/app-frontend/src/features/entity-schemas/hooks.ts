import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { sortEntitySchemas } from "./model";

export function useEntitySchemaQuery(entitySchemaId: string, enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"get",
		"/entity-schemas/{entitySchemaId}",
		{ params: { path: { entitySchemaId } } },
		{ enabled },
	);

	return { ...query, entitySchema: query.data?.data };
}

export function useEntitySchemasQuery(trackerId: string, enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"post",
		"/entity-schemas/list",
		{ body: { trackerId } },
		{ enabled },
	);

	return {
		...query,
		entitySchemas: sortEntitySchemas(query.data?.data ?? []),
	};
}

export function useEntitySchemasBySlugQuery(slugs: string[], enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"post",
		"/entity-schemas/list",
		{ body: { slugs } },
		{ enabled: enabled && slugs.length > 0 },
	);

	return {
		...query,
		entitySchemas: sortEntitySchemas(query.data?.data ?? []),
	};
}

export function useEntitySchemaMutations(trackerId: string) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("post", "/entity-schemas/list", {
		body: { trackerId },
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
