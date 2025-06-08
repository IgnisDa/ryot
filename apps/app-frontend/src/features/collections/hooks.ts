import { useApiClient } from "#/hooks/api";

export function useCollectionMutations() {
	const apiClient = useApiClient();

	const create = apiClient.useMutation("post", "/collections");

	const createCollection = async (name: string) => {
		return await create.mutateAsync({ body: { name } });
	};

	return { create, createCollection };
}
