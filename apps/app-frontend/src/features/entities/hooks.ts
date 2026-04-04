import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "~/hooks/api";
import type { ApiPostRequestBody } from "~/lib/api/types";
import { getErrorMessage } from "~/lib/errors";
import { createEntityRuntimeRequest, sortEntities, toAppEntity } from "./model";

export type CreateWithCollectionResult = {
	entity: { id: string; name: string };
	collectionError?: string;
};

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
				void queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	const addToCollection = apiClient.useMutation(
		"post",
		"/collections/memberships",
		{},
		queryClient,
	);

	const createWithCollection = async (
		body: ApiPostRequestBody<"/entities">,
		collectionId?: string,
	): Promise<CreateWithCollectionResult> => {
		const createResult = await create.mutateAsync({ body });
		const entity = createResult.data;

		if (!entity) {
			throw new Error("Failed to create entity");
		}

		if (collectionId) {
			try {
				await addToCollection.mutateAsync({
					body: {
						entityId: entity.id,
						collectionId,
						properties: {},
					},
				});
			} catch (error) {
				return {
					entity,
					collectionError: getErrorMessage(error),
				};
			}
		}

		return { entity };
	};

	return { create, addToCollection, createWithCollection };
}
